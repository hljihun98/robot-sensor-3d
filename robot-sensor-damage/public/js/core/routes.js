// REST 경로표 — 서버는 이 표대로 라우트를 만들고, 브라우저는 이 표대로 요청을 보낸다.
// 경로의 :이름 은 인자에서 채우고, GET은 나머지 인자를 쿼리로, 그 외는 JSON 본문으로 보낸다.

export const ROUTES = {
  login: ['POST', '/api/auth/login'],
  me: ['GET', '/api/auth/me'],
  changePassword: ['POST', '/api/auth/password'],
  stats: ['GET', '/api/stats'],

  listRobots: ['GET', '/api/robots'],
  nextRobotNo: ['GET', '/api/robots-next'],
  getRobot: ['GET', '/api/robots/:no'],
  createRobot: ['POST', '/api/robots'],
  updateRobot: ['PATCH', '/api/robots/:no'],
  disposeRobot: ['POST', '/api/robots/:no/dispose'],
  deleteRobot: ['DELETE', '/api/robots/:no'],
  replaceSensor: ['POST', '/api/robots/:no/mounts'],
  setMountYaw: ['PATCH', '/api/robots/:no/mounts/:slot'],

  getSensor: ['GET', '/api/sensors/:id'],
  listSpareSensors: ['GET', '/api/spare-sensors'],
  updateSensor: ['PATCH', '/api/sensors/:id'],
  getSensorView: ['GET', '/api/sensors/:id/view'],
  getSensorHistory: ['GET', '/api/sensors/:id/history'],
  addInspection: ['POST', '/api/sensors/:sensor_id/inspections'],
  duplicateCandidates: ['POST', '/api/sensors/:sensor_id/duplicates'],

  getDamage: ['GET', '/api/damages/:id'],
  createDamage: ['POST', '/api/damages'],
  updateDamage: ['PATCH', '/api/damages/:id'],

  listReports: ['GET', '/api/reports'],
  getReport: ['GET', '/api/reports/:id'],
  createReport: ['POST', '/api/reports'],
  openReview: ['POST', '/api/reports/:id/open'],
  replyReport: ['POST', '/api/reports/:id/reply'],
  requestInfo: ['POST', '/api/reports/:id/request-info'],
  rejectReport: ['POST', '/api/reports/:id/reject'],
  approveReport: ['POST', '/api/reports/:id/approve'],

  listUsers: ['GET', '/api/users'],
  createUser: ['POST', '/api/users'],
  updateUser: ['PATCH', '/api/users/:id'],
  listAudit: ['GET', '/api/audit'],
};

export const pathParams = (path) => [...path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]);
