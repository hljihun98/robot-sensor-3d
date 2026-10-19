import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { now } from './db.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = u => ({id:u.id,username:u.username,name:u.name,department:u.department,role:u.role,must_change:!!u.must_change});
export function installAuth(app, store, {secure=false}={}) {
  const {get,run,tx,audit}=store;
  const cookieOptions={httpOnly:true,sameSite:'strict',secure,path:'/'};
  app.use((req,res,next)=>{
    const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('rs_session='))?.slice(11);
    if(token) { const s=get('SELECT * FROM sessions WHERE token=? AND expires>?',hash(token),now()); if(s){const u=get('SELECT * FROM users WHERE id=? AND active=1',s.user_id); if(u){req.user=u;req.session=s;}} }
    next();
  });
  app.post('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'로그인 시도가 많습니다. 15분 후 다시 시도하세요.'}}),(req,res)=>{
    const {username,password,remember}=req.body;
    const u=typeof username==='string'?get('SELECT * FROM users WHERE username=? AND active=1',username):null;
    if(!u||typeof password!=='string'||!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:'아이디 또는 비밀번호를 확인하세요.'});
    const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex'),maxAge=(remember?30:1)*86400000;
    tx(()=>{run('DELETE FROM sessions WHERE expires<?',now());run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),u.id,csrf,new Date(Date.now()+maxAge).toISOString());audit(u.id,'LOGIN',u.id);});
    res.cookie('rs_session',token,{...cookieOptions,maxAge});res.json({user:publicUser(u),csrf});
  });
  app.use(['/api','/files'],(req,res,next)=>{
    if(!req.user)return res.status(401).json({error:'로그인이 필요합니다.'});
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['x-csrf-token']!==req.session.csrf)return res.status(403).json({error:'요청 인증이 만료되었습니다. 새로고침하세요.'});
    if(req.user.must_change&&!req.path.startsWith('/auth/'))return res.status(403).json({error:'먼저 임시 비밀번호를 변경하세요.',must_change:true});
    next();
  });
  app.get('/api/auth/me',(req,res)=>res.json({user:publicUser(req.user),csrf:req.session.csrf}));
  app.post('/api/auth/logout',(req,res)=>{run('DELETE FROM sessions WHERE token=?',req.session.token);res.clearCookie('rs_session',cookieOptions).json({ok:true});});
  app.post('/api/auth/password',(req,res)=>{
    const {current,password}=req.body;
    if(typeof current!=='string'||!bcrypt.compareSync(current,req.user.password_hash))return res.status(400).json({error:'현재 비밀번호가 맞지 않습니다.'});
    if(typeof password!=='string'||password.length<12||password.length>128||Buffer.byteLength(password)>72||password===current)return res.status(400).json({error:'새 비밀번호는 기존과 다른 12자 이상, UTF-8 72바이트 이하로 입력하세요.'});
    tx(()=>{run('UPDATE users SET password_hash=?,must_change=0 WHERE id=?',bcrypt.hashSync(password,12),req.user.id);run('DELETE FROM sessions WHERE user_id=? AND token<>?',req.user.id,req.session.token);audit(req.user.id,'PASSWORD_CHANGED',req.user.id);});
    res.json({ok:true});
  });
}
export const requireRole = (...roles) => (req,res,next) => roles.includes(req.user.role)?next():res.status(403).json({error:'이 작업을 수행할 권한이 없습니다.'});
