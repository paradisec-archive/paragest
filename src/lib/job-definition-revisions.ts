type ActiveRevision = {
  jobDefinitionArn: string;
  jobDefinitionName: string;
  revision: number;
};

export const parseJobDefinitionArn = (arn: string) => {
  const [, name, revision] = arn.match(/job-definition\/(.+):(\d+)$/) ?? [];
  if (!name || !revision) {
    throw new Error(`Not a job definition revision ARN: ${arn}`);
  }

  return { name, revision: Number(revision) };
};

export const jobDefinitionArnsIn = (definition: string) => [...new Set(definition.match(/arn:aws:batch:[^:"]+:\d+:job-definition\/[^:"]+:\d+/g) ?? [])];

// Older revisions of the current job definitions, minus any that an execution started
// before a deploy still submits
export const supersededRevisions = (currentArns: string[], active: ActiveRevision[], inUseArns: string[]) => {
  const currentRevisions = new Map(currentArns.map((arn) => parseJobDefinitionArn(arn)).map(({ name, revision }) => [name, revision]));
  const inUse = new Set(inUseArns);

  return active
    .filter(({ jobDefinitionArn, jobDefinitionName, revision }) => {
      const current = currentRevisions.get(jobDefinitionName);

      return current !== undefined && revision < current && !inUse.has(jobDefinitionArn);
    })
    .map(({ jobDefinitionArn }) => jobDefinitionArn);
};
