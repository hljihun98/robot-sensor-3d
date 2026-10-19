// 브라우저 데모는 한 사람만 쓰므로 로그인 횟수 제한을 두지 않는다.
export const rateLimit = () => (req, res, next) => next();
export default rateLimit;
