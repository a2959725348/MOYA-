/* Background playback only. No Canvas, WebGL, live water or particle rendering. */
(() => {
 'use strict';
 const layers=[...document.querySelectorAll('.video-layer')],videos=layers.map(l=>l.querySelector('video'));
 let paused=matchMedia('(prefers-reduced-motion: reduce)').matches,weights=[1,0,0],loaded=[false,false,false],visible=[false,false,false];
 const clamp=x=>Math.max(0,Math.min(1,x)),smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
 function load(index){if(loaded[index])return;loaded[index]=true;const v=videos[index];v.muted=true;v.defaultMuted=true;v.src=v.dataset.src;v.load()}
 function sync(index){const v=videos[index],shouldPlay=weights[index]>.015&&!paused&&!document.hidden;visible[index]=shouldPlay;if(shouldPlay){load(index);if(v.paused)v.play().catch(()=>{if(v.readyState>=2)document.querySelector('#play-scenes').hidden=false})}else if(!v.paused)v.pause()}
 function syncAll(){videos.forEach((_,i)=>sync(i))}
 videos.forEach((v,i)=>{v.addEventListener('playing',()=>{v.classList.add('ready');document.querySelector('#play-scenes').hidden=true});v.addEventListener('loadeddata',()=>{v.classList.add('ready');sync(i)});v.addEventListener('error',()=>{layers[i].classList.add('media-unavailable');document.querySelector('#live-status').textContent='背景视频暂不可播放，已显示同画面的静态封面。'})});
 document.querySelector('#play-scenes').addEventListener('click',()=>{paused=false;document.documentElement.classList.remove('motion-paused');document.querySelector('#motion-toggle').setAttribute('aria-pressed','false');document.querySelector('#motion-toggle').textContent='暂停动态';syncAll()});
 document.addEventListener('visibilitychange',syncAll);
 window.VideoScene={setDive(dive,y){const deep=smooth(innerHeight*2.0,innerHeight*2.85,y),shallow=smooth(.02,.96,dive);weights=[1-shallow,shallow*(1-deep),deep];layers[0].style.opacity=1;layers[1].style.opacity=shallow.toFixed(4);layers[2].style.opacity=deep.toFixed(4);layers[0].style.transform=`scale(${1+dive*.075}) translateY(${-dive*3}%)`;layers[1].style.transform=`scale(${1.035+deep*.04})`;layers[2].style.transform=`scale(${1.025+Math.min(.04,(y/innerHeight)*.003)})`;document.documentElement.style.setProperty('--submerged',dive.toFixed(3));if(dive>.01)load(1);if(y>innerHeight*1.45)load(2);videos.forEach((v,i)=>{const next=weights[i]>.015&&!paused&&!document.hidden;if(next!==visible[i])sync(i)})},setPaused(value){paused=value;syncAll()},get paused(){return paused},get backend(){return'html5-video'},bubble(){}};
 load(0);syncAll();
})();
