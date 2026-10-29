import { describe, expect, it } from 'vitest';

import { jobDefinitionArnsIn, supersededRevisions } from './job-definition-revisions';

const arn = (name: string, revision: number) => `arn:aws:batch:ap-southeast-2:123456789012:job-definition/${name}:${revision}`;
const active = (name: string, revision: number) => ({ jobDefinitionArn: arn(name, revision), jobDefinitionName: name, revision });

describe('jobDefinitionArnsIn', () => {
  it('finds every job definition revision a state machine definition submits', () => {
    const definition = JSON.stringify({
      States: {
        AddToCatalog: { Resource: 'arn:aws:states:::batch:submitJob.waitForTaskToken', Parameters: { JobDefinition: arn('AddToCatalog', 20) } },
        FixSilence: { Resource: 'arn:aws:states:::batch:submitJob.waitForTaskToken', Parameters: { JobDefinition: arn('FixSilence', 4) } },
        Lambda: { Resource: 'arn:aws:lambda:ap-southeast-2:123456789012:function:ProcessFailure' },
      },
    });

    expect(jobDefinitionArnsIn(definition)).toEqual([arn('AddToCatalog', 20), arn('FixSilence', 4)]);
  });
});

describe('supersededRevisions', () => {
  it('returns the older active revisions of each current job definition', () => {
    const result = supersededRevisions(
      [arn('AddToCatalog', 21), arn('FixSilence', 4)],
      [active('AddToCatalog', 19), active('AddToCatalog', 20), active('AddToCatalog', 21), active('FixSilence', 4)],
      [],
    );

    expect(result).toEqual([arn('AddToCatalog', 19), arn('AddToCatalog', 20)]);
  });

  it('keeps an older revision a running execution still submits', () => {
    const result = supersededRevisions(
      [arn('AddToCatalog', 21)],
      [active('AddToCatalog', 19), active('AddToCatalog', 20), active('AddToCatalog', 21)],
      [arn('AddToCatalog', 20)],
    );

    expect(result).toEqual([arn('AddToCatalog', 19)]);
  });

  it('leaves a revision newer than the current one alone', () => {
    expect(supersededRevisions([arn('AddToCatalog', 21)], [active('AddToCatalog', 21), active('AddToCatalog', 22)], [])).toEqual([]);
  });

  it('ignores job definitions the state machine does not use', () => {
    expect(supersededRevisions([arn('AddToCatalog', 21)], [active('AddToCatalog', 21), active('SomethingElse', 1)], [])).toEqual([]);
  });
});
