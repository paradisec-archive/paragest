import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import { getUserByUnikey, type EmailUser } from '../models/user.js';

const ses = new SESClient();

const env = process.env.PARAGEST_ENV;

const defaultEmail = env === 'prod' ? 'admin@paradisec.org.au' : 'jferlito@gmail.com';
const cc = env === 'prod' ? [] : ['jferlito@gmail.com'];

// eslint-disable-next-line no-unused-vars
export const sendEmail = async (principalId: string, subject: string, bodyFunc: (admin: EmailUser, unikey: string) => string) => {
  const unikey = principalId.replace(/.*:/, '');
  const admin = await getUserByUnikey(unikey);

  const from = defaultEmail;
  const to = admin?.email ? [`${admin.firstName} ${admin.lastName} <${admin.email}>`] : [defaultEmail];
  const body = bodyFunc(admin, unikey);
  console.error(from);
  console.error(to);
  console.error(subject);
  console.error(body);

  const sendEmailCommand = new SendEmailCommand({
    Source: from,
    Destination: {
      ToAddresses: to,
      CcAddresses: cc,
    },
    Message: {
      Subject: {
        Data: subject,
      },
      Body: {
        Text: {
          Data: body,
        },
      },
    },
  });

  const response = await ses.send(sendEmailCommand);
  console.error(response);
};
