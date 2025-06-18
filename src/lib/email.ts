import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';

import { getUserByUnikey, type EmailUser } from '../models/user.js';
import { getSecret } from './secrets.js';

type SESSmtpCredentials = {
  username: string;
  password: string;
  endpoint: string;
};

let transport: nodemailer.Transporter | undefined;

const convertToSmtpPassword = (secretAccessKey: string): string => {
  const key = Buffer.from('SendRawEmail', 'utf8');
  const message = Buffer.from(secretAccessKey, 'utf8');
  const signature = createHmac('sha256', key).update(message).digest();
  const version = Buffer.from([0x02]);
  const smtpPassword = Buffer.concat([version, signature]).toString('base64');
  return smtpPassword;
};

const getTransporter = async () => {
  if (transport) {
    return transport;
  }

  const secretArn = process.env.SES_SMTP_SECRET_ARN;
  if (!secretArn) {
    throw new Error('SES_SMTP_SECRET_ARN environment variable is not set');
  }

  const credentials = await getSecret<SESSmtpCredentials>(secretArn);
  const smtpPassword = convertToSmtpPassword(credentials.password);

  transport = nodemailer.createTransport({
    host: credentials.endpoint,
    port: 587,
    secure: false,
    auth: {
      user: credentials.username,
      pass: smtpPassword,
    },
  });

  return transport;
};

const env = process.env.PARAGEST_ENV;

const defaultEmail = env === 'prod' ? 'admin@paradisec.org.au' : 'jferlito@gmail.com';
const cc = env === 'prod' ? [] : ['jferlito@gmail.com'];

// eslint-disable-next-line no-unused-vars
export const sendEmail = async (
  principalId: string,
  subject: string,
  bodyFunc: (admin: EmailUser, unikey: string) => string,
) => {
  const unikey = principalId.replace(/.*:/, '');
  const admin = await getUserByUnikey(unikey);

  const from = defaultEmail;
  const to = admin?.email ? [`${admin.firstName} ${admin.lastName} <${admin.email}>`] : [defaultEmail];
  const body = bodyFunc(admin, unikey);
  console.error(from);
  console.error(to);
  console.error(subject);
  console.error(body);

  const mailOptions = {
    from: from,
    to: to.join(', '),
    cc: cc.join(', '),
    subject: subject,
    text: body,
  };

  // NOTE: We use SMTP insead of sendMail as VPC endpoints do not support the latter
  const transporter = await getTransporter();
  const response = await transporter.sendMail(mailOptions);
  console.error(response);
};
