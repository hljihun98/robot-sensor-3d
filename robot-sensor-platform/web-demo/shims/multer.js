// 브라우저용 multer — FormData의 파일을 multer와 같은 모양({ buffer, originalname, size })으로 req.files / req.file 에 넣는다.
const MESSAGES = { LIMIT_FILE_SIZE: 'File too large', LIMIT_FILE_COUNT: 'Too many files', LIMIT_UNEXPECTED_FILE: 'Unexpected field', LIMIT_FIELD_VALUE: 'Field value too long' };

class MulterError extends Error {
  constructor(code, field) {
    super(MESSAGES[code] ?? code);
    this.name = 'MulterError';
    this.code = code;
    this.field = field;
  }
}

export default function multer({ limits = {} } = {}) {
  const parse = (field, max, single) => async (req, res, next) => {
    if (!String(req.headers['content-type'] ?? '').includes('multipart/form-data')) return next();
    try {
      const form = await req.raw.formData();
      const body = {};
      const files = [];
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') {
          if (limits.fieldSize && value.length > limits.fieldSize) throw new MulterError('LIMIT_FIELD_VALUE', key);
          body[key] = key in body ? [].concat(body[key], value) : value;
          continue;
        }
        if (key !== field) throw new MulterError('LIMIT_UNEXPECTED_FILE', key);
        const buffer = Buffer.from(await value.arrayBuffer());
        if (limits.fileSize && buffer.length > limits.fileSize) throw new MulterError('LIMIT_FILE_SIZE', key);
        files.push({ fieldname: key, originalname: value.name || 'blob', mimetype: value.type, size: buffer.length, buffer });
        if (files.length > max || (limits.files && files.length > limits.files)) throw new MulterError(single ? 'LIMIT_UNEXPECTED_FILE' : 'LIMIT_FILE_COUNT', key);
      }
      req.body = body;
      req.bodyParsed = true;
      if (single) req.file = files[0];
      else req.files = files;
      next();
    } catch (e) {
      next(e);
    }
  };
  return { array: (field, max = Infinity) => parse(field, max, false), single: (field) => parse(field, 1, true) };
}
multer.memoryStorage = () => ({});
multer.MulterError = MulterError;
