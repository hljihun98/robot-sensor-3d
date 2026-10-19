export const TYPES=['SCRATCH','DENT','CRACK','CHIP','COATING','DEFORM','ETC'];
export function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
export function text(v,max=2000,required=false){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail('입력 내용을 확인하세요.');return v.trim();}
export function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail('올바른 날짜를 입력하세요.');return v;}
export function payload(raw,today){
  let p=raw; if(typeof raw==='string'){try{p=JSON.parse(raw);}catch{fail('신고 형식이 올바르지 않습니다.');}}
  if(!p||!TYPES.includes(p.type))fail('파손 유형을 선택하세요.');
  const part=text(p.part,60,true),note=text(p.note??'',2000),found_at=date(p.found_at);
  if(found_at>today)fail('발견일은 미래일 수 없습니다.');
  if(p.type==='ETC'&&!note)fail('기타 유형은 메모가 필요합니다.');
  const points=p.points_mm;
  if(!Array.isArray(points)||points.length<1||points.length>100||!points.every(v=>Array.isArray(v)&&v.length===3&&v.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=500)))fail('3D 표면에서 파손 위치를 선택하세요.');
  const normal=p.normal;
  if(!Array.isArray(normal)||normal.length!==3||!normal.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1.01)||Math.hypot(...normal)<0.9)fail('표면 방향이 올바르지 않습니다.');
  const shape=p.shape||'POINT';
  if(!['POINT','LINE','CIRCLE','AREA'].includes(shape)||shape==='LINE'&&points.length<2||shape==='AREA'&&points.length<3)fail('선은 두 점, 영역은 세 점 이상을 지정하세요.');
  let size_mm=null;
  if(shape==='LINE')size_mm=points.slice(1).reduce((sum,v,i)=>sum+Math.hypot(...v.map((x,j)=>x-points[i][j])),0);
  if(shape==='CIRCLE'){size_mm=Number(p.size_mm);if(!Number.isFinite(size_mm)||size_mm<=0||size_mm>500)fail('지름은 0~500mm 사이로 입력하세요.');}
  return {type:p.type,part,note,found_at,points_mm:points,normal,shape,size_mm};
}
