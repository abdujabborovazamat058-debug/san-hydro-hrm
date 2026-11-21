/* Kamera, yuz tanish (face-api, telefon ichida) va GPS */
(function(){
var MODELS="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/";
var loading=null,stream=null;
function loadModels(){
  if(loading)return loading;
  loading=(async function(){
    if(!window.faceapi)throw new Error("lib");
    await faceapi.tf.ready();
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS);
    await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS);
    await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS);
  })();
  loading.catch(function(){loading=null;});
  return loading;
}
async function startCamera(video){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error("cam");
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
  video.srcObject=stream;video.muted=true;await video.play();
  await new Promise(function(r){if(video.videoWidth)r();else video.onloadedmetadata=r;});
}
function stopCamera(video){if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;}if(video)video.srcObject=null;}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
function dist(a,b){var s=0;for(var i=0;i<128;i++)s+=(a[i]-b[i])*(a[i]-b[i]);return Math.sqrt(s);}
function cropPhoto(video,box){
  var c=document.createElement("canvas");c.width=c.height=96;
  var cx=box.x+box.width/2,cy=box.y+box.height/2,s=Math.max(box.width,box.height)*1.5;
  var sx=Math.max(0,cx-s/2),sy=Math.max(0,cy-s/2);s=Math.min(s,video.videoWidth-sx,video.videoHeight-sy);
  c.getContext("2d").drawImage(video,sx,sy,s,s,0,0,96,96);return c.toDataURL("image/jpeg",0.7);
}
/* 3 kadr oladi, bir-biriga mos kelsa o'rtachasini qaytaradi */
async function capture(video){
  var opts=new faceapi.TinyFaceDetectorOptions({inputSize:320,scoreThreshold:0.5});
  var got=[],photo=null,tries=0;
  while(got.length<3&&tries<14){
    tries++;
    var r=await faceapi.detectSingleFace(video,opts).withFaceLandmarks().withFaceDescriptor();
    if(r&&r.detection.box.width>video.videoWidth*0.22){got.push(Array.from(r.descriptor));if(!photo)photo=cropPhoto(video,r.detection.box);}
    await sleep(250);
  }
  if(got.length<3)throw new Error("noface");
  if(dist(got[0],got[1])>0.45||dist(got[0],got[2])>0.45)throw new Error("noface");
  var avg=new Array(128).fill(0);got.forEach(function(d){for(var i=0;i<128;i++)avg[i]+=d[i]/3;});
  return {descriptor:avg,photo:photo};
}
function gps(){
  return new Promise(function(res,rej){
    if(!navigator.geolocation)return rej(new Error("gps"));
    navigator.geolocation.getCurrentPosition(function(p){res({lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy});},function(){rej(new Error("gps"));},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  });
}
window.Face={loadModels:loadModels,startCamera:startCamera,stopCamera:stopCamera,capture:capture,gps:gps};
})();
