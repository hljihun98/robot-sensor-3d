import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export const colors={SCRATCH:'#e4a12c',DENT:'#438bca',CRACK:'#dc5860',CHIP:'#9b6dc1',COATING:'#3d9c88',DEFORM:'#dd7d40',ETC:'#7b8795'};
export const parts={window:'창',body:'하우징',base:'하단 베이스',bracket:'브라켓',lens_left:'왼쪽 렌즈',lens_right:'오른쪽 렌즈',cover:'앞면 커버',connector:'커넥터',cap:'상단 캡'};
export class SensorViewer {
 constructor(el,sensor,{onPick=()=>{},onSelect=()=>{}}={}) {
  this.el=el;this.sensor=sensor;this.onPick=onPick;this.onSelect=onSelect;this.disposed=false;this.picking=false;this.scene=new THREE.Scene();
  this.camera=new THREE.PerspectiveCamera(38,1,.1,2000);this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.setClearColor(0xeef2f0,0);this.renderer.outputColorSpace=THREE.SRGBColorSpace;el.append(this.renderer.domElement);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.minDistance=55;this.controls.maxDistance=500;this.controls.target.set(0,0,0);this.camera.position.set(112,85,145);
  this.scene.add(new THREE.HemisphereLight(0xffffff,0x7a8d83,3));let l=new THREE.DirectionalLight(0xffffff,3.8);l.position.set(70,100,90);this.scene.add(l);l=new THREE.DirectionalLight(0xd4e5ff,2);l.position.set(-80,40,-60);this.scene.add(l);
  this.model=new THREE.Group();this.markers=new THREE.Group();this.sketch=new THREE.Group();this.scene.add(this.model,this.markers,this.sketch);
  const grid=new THREE.GridHelper(280,28,0xc3cec6,0xdce3dd);grid.position.y=-54;this.scene.add(grid);
  this.ray=new THREE.Raycaster();this.pointer=new THREE.Vector2();this.meshes=[];this.build();
  if(sensor.file)new GLTFLoader().load('/files/models/'+encodeURIComponent(sensor.file),g=>{if(this.disposed)return;this.release(this.model);this.model.clear();this.model.add(g.scene);this.meshes=[];g.scene.traverse(o=>{if(o.isMesh)this.meshes.push(o);});},undefined,()=>{el.dispatchEvent(new CustomEvent('model-error',{bubbles:true}));});
  this.renderer.domElement.addEventListener('pointerdown',e=>{this.down={x:e.clientX,y:e.clientY};});
  this.renderer.domElement.addEventListener('pointerup',e=>{if(!this.down||Math.hypot(e.clientX-this.down.x,e.clientY-this.down.y)>6)return;const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);const mh=this.ray.intersectObjects(this.markers.children,true)[0];if(mh&&!this.picking){const id=mh.object.userData.id;if(id)this.onSelect(id);return;}if(!this.picking)return;const hit=this.ray.intersectObjects(this.meshes,true)[0];if(!hit)return;const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();this.onPick({point:hit.point.toArray().map(n=>+n.toFixed(2)),normal:normal.toArray(),part:hit.object.name||'body'});});
  this.resize=new ResizeObserver(()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();});this.resize.observe(el);
  this.animate=()=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.animate);this.controls.update();this.renderer.render(this.scene,this.camera);};this.animate();
 }
 release(group){group.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.map?.dispose();m.dispose();}}});}
 build(){
  const metal=new THREE.MeshStandardMaterial({color:0xbcc7c5,metalness:.6,roughness:.35}),dark=new THREE.MeshStandardMaterial({color:0x182a2b,metalness:.5,roughness:.22}),glass=new THREE.MeshStandardMaterial({color:0x163d3e,metalness:.7,roughness:.15}),black=new THREE.MeshStandardMaterial({color:0x253532,metalness:.2,roughness:.7});
  const mesh=(geo,mat,pos,name,rot)=>{const o=new THREE.Mesh(geo,mat.clone());o.position.set(...pos);o.name=name;if(rot)o.rotation.set(...rot);this.model.add(o);this.meshes.push(o);return o;};
  const box=(x,y,z,pos,mat,name)=>mesh(new THREE.BoxGeometry(x,y,z),mat,pos,name);
  if(this.sensor.model==='DOME'){
   box(65,27,65,[0,-16.5,0],metal,'body');mesh(new THREE.SphereGeometry(31,64,32,0,Math.PI*2,0,Math.PI/2),glass,[0,-1,0],'window');box(64,4,64,[0,-32,0],black,'base');
   for(const x of [-26,26])for(const z of [-26,26])mesh(new THREE.CylinderGeometry(2.1,2.1,1,16),dark,[x,-2.5,z],'body');
   box(21,10,6,[0,-18,-35],dark,'connector');
  }else if(this.sensor.model==='CYLINDER'){
   mesh(new THREE.CylinderGeometry(39,39,13,64),metal,[0,35,0],'cap');mesh(new THREE.CylinderGeometry(38,38,38,64),glass,[0,9.5,0],'window');mesh(new THREE.CylinderGeometry(39,39,26,64),metal,[0,-22.5,0],'body');mesh(new THREE.CylinderGeometry(40,40,7,64),black,[0,-39,0],'base');box(18,12,7,[0,-27,-39],dark,'connector');
  }else{
   box(42,42,21,[0,0,0],metal,'body');box(41,41,2,[0,0,11.5],dark,'cover');
   for(const [x,name]of[[-11,'lens_left'],[11,'lens_right']]){mesh(new THREE.CylinderGeometry(7,7,2,40),black,[x,2,13],name,[Math.PI/2,0,0]);mesh(new THREE.CylinderGeometry(5.3,5.3,1,40),glass,[x,2,14.5],name,[Math.PI/2,0,0]);}
   box(13,6,3,[0,-10,-12],black,'connector');
  }
  box(this.sensor.model==='CAMERA'?30:48,4,30,[0,this.sensor.model==='CAMERA'?-24:this.sensor.model==='DOME'?-37:-46,0],black,'bracket');
 }
 setPicking(value){this.picking=value;this.renderer.domElement.style.cursor=value?'crosshair':'grab';}
 setView(view){const d=180;const p={front:[0,15,d],back:[0,15,-d],side:[d,15,0],top:[0,d,.01],reset:[112,85,145]}[view];this.camera.position.set(...p);this.controls.target.set(0,0,0);this.controls.update();}
 focus(d){const p=new THREE.Vector3(...d.points_mm[0]),n=new THREE.Vector3(...d.normal);this.camera.position.copy(p).addScaledVector(n,150);this.controls.target.copy(p.clone().multiplyScalar(.4));this.controls.update();}
 setMarkers(damages,selected){this.release(this.markers);this.markers.clear();damages.forEach((d,i)=>this.draw(this.markers,d,i+1,d.id===selected));}
 setSketch(points,normal,shape='POINT',size_mm=3){this.release(this.sketch);this.sketch.clear();if(points.length)this.draw(this.sketch,{points_mm:points,normal,shape,size_mm,type:'COATING'},'+',true);}
 draw(group,d,label,selected){
  const color=colors[d.type]||'#3d9c88',n=new THREE.Vector3(...d.normal),points=d.points_mm.map(p=>new THREE.Vector3(...p).addScaledVector(n,.7));
  if(d.shape==='LINE'||d.shape==='AREA'){
   const pts=d.shape==='AREA'?[...points,points[0]]:points;const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color}));line.userData.id=d.id;group.add(line);
   if(d.shape==='AREA'&&points.length>=3){const vertices=[];for(let i=1;i<points.length-1;i++)vertices.push(...points[0].toArray(),...points[i].toArray(),...points[i+1].toArray());const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.computeVertexNormals();group.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color,transparent:true,opacity:.35,side:THREE.DoubleSide})));}
  }
  const ring=new THREE.Mesh(new THREE.RingGeometry(d.shape==='CIRCLE'?d.size_mm/2:2.1,d.shape==='CIRCLE'?d.size_mm/2+.7:3,36),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));ring.position.copy(points[0]);ring.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);ring.userData.id=d.id;group.add(ring);
  const canvas=document.createElement('canvas');canvas.width=80;canvas.height=80;const c=canvas.getContext('2d');c.fillStyle=selected?'#123d36':'white';c.beginPath();c.arc(40,40,32,0,Math.PI*2);c.fill();c.strokeStyle=color;c.lineWidth=5;c.stroke();c.fillStyle=selected?'white':'#243b33';c.font='bold 31px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(label),40,42);
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),sizeAttenuation:false,depthTest:true}));sprite.scale.set(.043,.043,1);sprite.position.copy(points[0]).addScaledVector(n,4);sprite.userData.id=d.id;group.add(sprite);
 }
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);this.resize.disconnect();this.controls.dispose();this.release(this.scene);this.renderer.dispose();this.renderer.domElement.remove();}
}
