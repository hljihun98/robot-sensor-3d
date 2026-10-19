import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import sharp from 'sharp';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/app.js';
import {today} from '../server/db.js';

test('현장 신고, 권한, 승인, 날짜 이력, 센서 이동의 통합 흐름',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'sensorlog-test-'));
 const {app,store}=createApp({dataDir:dir,initialPassword:'Initial-Test-Password!'});
 const admin=request.agent(app),field=request.agent(app),other=request.agent(app);let ac,fc,oc,reportId,damageId,photoUrl;
 const image=await sharp({create:{width:80,height:60,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
 const p={type:'SCRATCH',part:'window',shape:'POINT',points_mm:[[0,29,0]],normal:[0,1,0],found_at:'2026-01-10',note:'테스트 파손'};
 try{
 await t.test('로그인 전 API 차단 및 초기 호기 경계 규칙',async()=>{
  assert.equal((await request(app).get('/api/robots')).status,401);
  const login=await admin.post('/api/auth/login').send({username:'admin',password:'Initial-Test-Password!'});assert.equal(login.status,200);ac=login.body.csrf;
  assert.equal((await admin.get('/api/robots')).status,403);
  assert.equal((await admin.post('/api/auth/password').set('X-CSRF-Token',ac).send({current:'Initial-Test-Password!',password:'New-Admin-Password!'})).status,200);
  const all=(await admin.get('/api/robots?status=ALL')).body;assert.equal(all.length,30);assert.equal(all.filter(r=>r.status==='ACTIVE').length,25);assert.equal(all.find(r=>r.no===16).shape,'CYLINDER');assert.equal(all.find(r=>r.no===17).shape,'DOME');
 });
 await t.test('CSRF, 역할, 개인별 계정과 비밀번호 변경',async()=>{
  assert.equal((await admin.post('/api/robots').send({no:31})).status,403);
  for(const [username,agent]of[['field',field],['other',other]]){
   assert.equal((await admin.post('/api/users').set('X-CSRF-Token',ac).send({username,name:username,role:'FIELD',password:'Initial-Field-Password!'})).status,201);
   const l=await agent.post('/api/auth/login').send({username,password:'Initial-Field-Password!'}),c=l.body.csrf;
   assert.equal((await agent.post('/api/auth/password').set('X-CSRF-Token',c).send({current:'Initial-Field-Password!',password:'New-Field-Password!'})).status,200);
   if(username==='field')fc=c;else oc=c;
  }
  assert.equal((await field.post('/api/users').set('X-CSRF-Token',fc).send({})).status,403);
  assert.equal((await field.get('/api/users')).status,403);
 });
 const sensor=(await admin.get('/api/robots/18')).body.sensors.find(s=>s.slot==='LIDAR_1');
 await t.test('사진 2장 필수와 승인 전 신고/사진 비공개',async()=>{
  assert.equal((await field.post('/api/reports').set('X-CSRF-Token',fc).field('sensor_id',String(sensor.id)).field('payload',JSON.stringify(p)).attach('photos',image,'one.jpg')).status,400);
  const r=await field.post('/api/reports').set('X-CSRF-Token',fc).field('sensor_id',String(sensor.id)).field('payload',JSON.stringify(p)).attach('photos',image,'전체.jpg').attach('photos',image,'근접.jpg');assert.equal(r.status,201);reportId=r.body.id;
  const mine=(await field.get('/api/reports?mine=1')).body;assert.equal(mine.length,1);photoUrl=mine[0].photos[0].url;
  assert.equal((await other.get('/api/reports')).body.length,0);assert.equal((await other.get(photoUrl)).status,404);assert.equal((await request(app).get(photoUrl)).status,401);assert.equal((await field.get(photoUrl)).status,200);
  assert.equal((await field.get(`/api/sensors/${sensor.id}/damages`)).body.length,0);
 });
 await t.test('보완 요청 사유 필수, 소유자만 보완, 승인 원자성',async()=>{
  assert.equal((await field.post(`/api/reports/${reportId}/approve`).set('X-CSRF-Token',fc).send({})).status,403);
  assert.equal((await admin.post(`/api/reports/${reportId}/request-info`).set('X-CSRF-Token',ac).send({reason:''})).status,400);
  assert.equal((await admin.post(`/api/reports/${reportId}/request-info`).set('X-CSRF-Token',ac).send({reason:'발견 상황을 알려주세요.'})).status,200);
  assert.equal((await other.post(`/api/reports/${reportId}/reply`).set('X-CSRF-Token',oc).field('note','다른 사용자')).status,403);
  assert.equal((await field.post(`/api/reports/${reportId}/reply`).set('X-CSRF-Token',fc).field('note','점검 중 발견')).status,200);
  const approved=await admin.post(`/api/reports/${reportId}/approve`).set('X-CSRF-Token',ac).send({});assert.equal(approved.status,200);damageId=approved.body.id;
  assert.equal((await admin.post(`/api/reports/${reportId}/approve`).set('X-CSRF-Token',ac).send({})).status,409);
  assert.equal((await other.get(photoUrl)).status,200);assert.equal((await other.get(`/api/sensors/${sensor.id}/damages`)).body.length,1);
 });
 await t.test('정정 전 좌표와 날짜 기준 상태 보존',async()=>{
  const corrected={...p,type:'DENT',points_mm:[[1,29,0]],shape:'CIRCLE',size_mm:4};
  assert.equal((await admin.patch('/api/damages/'+damageId).set('X-CSRF-Token',ac).field('action','CORRECTED').field('reason','유형 정정').field('payload',JSON.stringify(corrected))).status,200);
  store.run("UPDATE damage_events SET at='2026-02-01T00:00:00.000Z' WHERE damage_id=? AND kind='CORRECTED'",damageId);
  let ds=(await field.get(`/api/sensors/${sensor.id}/damages?at=2026-01-15`)).body;assert.equal(ds[0].type,'SCRATCH');assert.deepEqual(ds[0].points_mm,[[0,29,0]]);
  ds=(await field.get(`/api/sensors/${sensor.id}/damages?at=2026-02-02`)).body;assert.equal(ds[0].type,'DENT');
  assert.equal((await field.get(`/api/sensors/${sensor.id}/damages?at=2026-01-09`)).body.length,0);
 });
 await t.test('기존 파손에 중복 신고 병합, 새 파손 추가 없이 사진 보존',async()=>{
  const r=await field.post('/api/reports').set('X-CSRF-Token',fc).field('sensor_id',String(sensor.id)).field('payload',JSON.stringify(p)).attach('photos',image,'again-full.jpg').attach('photos',image,'again-detail.jpg');assert.equal(r.status,201);
  const result=await admin.post(`/api/reports/${r.body.id}/approve`).set('X-CSRF-Token',ac).send({merge_id:damageId});assert.equal(result.status,200);assert.equal(result.body.id,damageId);
  const d=(await admin.get('/api/damages/'+damageId)).body;assert.equal(d.photos.length,4);assert.equal(d.type,'DENT');assert(d.events.some(e=>e.kind==='MERGED'));assert.equal(store.get('SELECT count(*) n FROM damages').n,1);
 });
 await t.test('점검 기준 기간은 한국 날짜로 계산, 잘못된 사진/좌표 차단',async()=>{
  assert.equal((await field.post(`/api/sensors/${sensor.id}/inspections`).set('X-CSRF-Token',fc).send({note:'일상 점검'})).status,200);
  assert((await field.get(`/api/sensors/${sensor.id}/history`)).body.some(e=>e.kind==='INSPECTED'));
  const invalid={...p,points_mm:[[null,0,0]]};
  assert.equal((await field.post('/api/reports').set('X-CSRF-Token',fc).field('sensor_id',String(sensor.id)).field('payload',JSON.stringify(invalid)).attach('photos',image,'one.jpg').attach('photos',image,'two.jpg')).status,400);
  assert.equal((await field.post('/api/models/DOME').set('X-CSRF-Token',fc)).status,403);
  assert.equal((await admin.post('/api/models/DOME').set('X-CSRF-Token',ac).attach('file',Buffer.from('not-glb'),'fake.glb')).status,400);
 });
 await t.test('센서 교체 후 회수 및 다른 호기 장착 시 파손 유지',async()=>{
  assert.equal((await admin.post('/api/robots/18/mounts').set('X-CSRF-Token',ac).send({slot:'LIDAR_1',serial:'TEST-NEW-LIDAR',position:'전방',old_status:'SPARE'})).status,200);
  assert.equal((await admin.get('/api/sensors')).body.find(s=>s.id===sensor.id).status,'SPARE');
  assert.equal((await admin.post('/api/robots/19/mounts').set('X-CSRF-Token',ac).send({slot:'LIDAR_1',sensor_id:sensor.id,old_status:'SPARE',position:'전방'})).status,200);
  const r=(await field.get('/api/robots/19')).body;assert.equal(r.sensors.find(s=>s.slot==='LIDAR_1').id,sensor.id);assert.equal(r.sensors.find(s=>s.slot==='LIDAR_1').damage_count,1);
  assert.equal((await admin.post('/api/robots/20/mounts').set('X-CSRF-Token',ac).send({slot:'LIDAR_1',sensor_id:sensor.id,old_status:'SPARE'})).status,400);
 });
 await t.test('수리 사진 필수, 과거 상태 보존, 반복 상태 변경 차단',async()=>{
  assert.equal((await admin.patch('/api/damages/'+damageId).set('X-CSRF-Token',ac).field('action','REPAIRED').field('reason','보수 완료')).status,400);
  assert.equal((await admin.patch('/api/damages/'+damageId).set('X-CSRF-Token',ac).field('action','REPAIRED').field('reason','보수 완료').attach('photos',image,'수리후.jpg')).status,200);
  store.run("UPDATE damage_events SET at='2026-03-01T00:00:00.000Z' WHERE damage_id=? AND kind='REPAIRED'",damageId);
  assert.equal((await field.get(`/api/sensors/${sensor.id}/damages`)).body.length,0);assert.equal((await field.get(`/api/sensors/${sensor.id}/damages?at=2026-02-10`)).body.length,1);assert.equal((await field.get(`/api/sensors/${sensor.id}/damages?at=2026-03-02`)).body.length,0);
  assert.equal((await admin.patch('/api/damages/'+damageId).set('X-CSRF-Token',ac).field('action','CLOSED').field('reason','중복 종료')).status,409);
 });
 await t.test('CSV 전체 롤백과 영구 삭제 보호',async()=>{
  const before=(await admin.get('/api/robots/6')).body.sensors.find(s=>s.slot==='LIDAR_1');
  const csv='robot_no,slot,serial,position\n6,LIDAR_1,TEST-CSV-UNIQUE,front\n999,LIDAR_2,BAD,back';
  assert.equal((await admin.post('/api/robots/import-csv').set('X-CSRF-Token',ac).attach('file',Buffer.from(csv),'sensors.csv')).status,404);
  assert.equal((await admin.get('/api/sensors/'+before.id)).body.serial,before.serial);
  assert.equal((await admin.delete('/api/robots/6').set('X-CSRF-Token',ac).send({reason:'오등록'})).status,400);
  assert.equal((await admin.post('/api/robots').set('X-CSRF-Token',ac).send({no:31})).status,201);
  assert.equal((await admin.get('/api/robots/31')).body.shape,'DOME');
  assert.equal((await admin.delete('/api/robots/31').set('X-CSRF-Token',ac).send({reason:'오등록 테스트'})).status,200);
 });
 await t.test('폐기 센서별 처리 필수 및 회수 이력',async()=>{
  const r=(await admin.get('/api/robots/20')).body;
  assert.equal((await admin.post('/api/robots/20/dispose').set('X-CSRF-Token',ac).send({date:today(),reason:'폐기',sensors:{}})).status,400);
  assert.equal((await admin.get('/api/robots/20')).body.status,'ACTIVE');
  assert.equal((await admin.post('/api/robots/20/dispose').set('X-CSRF-Token',ac).send({date:today(),reason:'폐기',sensors:Object.fromEntries(r.sensors.map(s=>[s.id,'SPARE']))})).status,200);
  assert.equal((await admin.get('/api/robots/20')).body.status,'DISPOSED');assert.equal((await admin.get('/api/admin/disposed-sensors/20')).body.length,4);
 });
 await t.test('사용 중지 즉시 세션 차단, 변경 기록, 재시작 영속성',async()=>{
  const users=(await admin.get('/api/users')).body,fu=users.find(u=>u.username==='field');
  assert.equal((await admin.patch('/api/users/'+fu.id).set('X-CSRF-Token',ac).send({active:0})).status,200);assert.equal((await field.get('/api/robots')).status,401);
  const audit=(await admin.get('/api/audit')).body;assert(audit.some(a=>a.action==='REPORT_APPROVED'));assert(audit.some(a=>a.action==='SENSOR_MOUNTED'));
  store.db.close();const second=createApp({dataDir:dir});assert.equal(second.store.get('SELECT count(*) n FROM damages').n,1);assert.equal(JSON.parse(second.store.get('SELECT snapshot FROM damages WHERE id=?',damageId).snapshot).status,'REPAIRED');second.store.db.close();
 });
 }finally{try{store.db.close();}catch{}await rm(dir,{recursive:true,force:true});}
});
