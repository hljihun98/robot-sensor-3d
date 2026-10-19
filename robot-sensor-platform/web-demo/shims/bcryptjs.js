// bcryptjs — 브라우저에서는 비용 12가 느리므로 데모에서는 낮춰서 만든다(검사는 어떤 비용이든 그대로 된다).
import bcrypt from 'bcryptjs';

const DEMO_COST = 6;
export const hashSync = (pw) => bcrypt.hashSync(pw, DEMO_COST);
export const compareSync = (pw, hash) => bcrypt.compareSync(pw, hash);
export default { hashSync, compareSync };
