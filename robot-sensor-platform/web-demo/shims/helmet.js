// 브라우저 데모에는 보안 헤더를 붙일 곳이 없다(정적 파일은 GitHub Pages가 내려준다).
export default function helmet() {
  return (req, res, next) => next();
}
