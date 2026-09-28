/* Fixed-camera 2.5D animation. All pixels are a pure function of t (seconds).
 * Original upper image is the character texture; generated plate is sampled
 * ONLY below the waterline. No face replacement or crossfade between dragons.
 */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, v) => { const q = clamp((v - a) / (b - a)); return q * q * (3 - 2 * q); };
  const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const bump = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
  const power = t => {
    if (t < 1) return 0.2 * smooth(0, 1, t);
    if (t < 2.5) return 0.2 + 0.8 * smooth(1, 2.5, t);
    if (t < 3.3) return 1 - 0.08 * smooth(2.5, 3.3, t);
    return 0.92 * (1 - smooth(3.3, 5, t));
  };
  const vertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUV;
    void main(){gl_Position=vec4(aPosition,0.,1.);vUV=vec2((aPosition.x+1.)*.5,(1.-aPosition.y)*.5);}
  `;
  const fragmentSource = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uOriginal;
    uniform sampler2D uWater;
    uniform float uTime;
    uniform float uPower;
    float box(vec2 p,vec2 lo,vec2 hi,float feather){
      vec2 a=smoothstep(lo-vec2(feather),lo,p);
      vec2 b=1.-smoothstep(hi,hi+vec2(feather),p);
      return a.x*a.y*b.x*b.y;
    }
    vec2 turn(vec2 p,vec2 pivot,float angle){
      float c=cos(angle),s=sin(angle);vec2 q=p-pivot;
      return pivot+vec2(c*q.x-s*q.y,s*q.x+c*q.y);
    }
    void main(){
      vec2 p=vec2(4.,6.)+vUV*vec2(251.,349.);
      vec2 q=p;
      float t=uTime, e=uPower;
      float head=box(p,vec2(98.,134.),vec2(162.,209.),16.);
      q.y-=2.8*e*head;
      q.y-=.8*e*box(p,vec2(122.,202.),vec2(144.,214.),3.);
      float flank=(1.-smoothstep(51.,92.,p.x)+smoothstep(181.,218.,p.x))
          *smoothstep(47.,78.,p.y)*(1.-smoothstep(202.,226.,p.y));
      q.x-=e*flank*(2.5*sin(p.y*.115-t*3.4)+.85*sin(p.y*.28+t*2.));
      q.y-=e*flank*.65*sin(p.y*.09-t*2.4);
      float crest=box(p,vec2(116.,45.),vec2(168.,106.),9.);
      q.x-=e*crest*1.8*sin(p.y*.07-t*3.2);
      float whisker=box(p,vec2(14.,181.),vec2(90.,211.),5.)+box(p,vec2(179.,182.),vec2(239.,220.),5.);
      q.y-=e*whisker*3.0*sin(p.x*.047-t*3.0);
      float left=1.-smoothstep(18.,28.,length(p-vec2(75.,122.)));
      float right=1.-smoothstep(16.,26.,length(p-vec2(198.,122.)));
      q=mix(q,turn(q,vec2(83.,101.),-.145*e*sin(t*4.3)),left);
      q=mix(q,turn(q,vec2(191.,102.),.135*e*sin(t*4.3+.45)),right);
      float wet=smoothstep(220.,245.,p.y);
      float radius=abs(p.x-130.);
      float surge=sin(radius*.065-t*5.0)*exp(-abs(p.y-252.)*.016);
      q.x-=wet*e*sign(p.x-130.)*(2.5+2.6*surge);
      q.y-=wet*e*(1.6*sin(radius*.08-t*5.)+.8*sin(p.y*.12+t*4.));
      vec3 original=texture2D(uOriginal,q/vec2(259.,359.)).rgb;
      vec3 water=texture2D(uWater,q/vec2(259.,359.)).rgb;
      float lower=smoothstep(224.,240.,p.y);
      vec3 col=mix(original,water,lower);
      float edge=min(min(p.x,259.-p.x),min(p.y,359.-p.y));
      col=mix(col,texture2D(uWater,p/vec2(259.,359.)).rgb,(1.-smoothstep(5.,11.,edge))*(1.-lower));
      float gold=smoothstep(.06,.27,col.r-col.b)*smoothstep(.22,.55,col.r);
      float scales=box(p,vec2(29.,110.),vec2(226.,224.),8.)*(1.-box(p,vec2(87.,124.),vec2(174.,213.),13.));
      float sweep=exp(-pow((p.x+p.y*.68-(40.+t*86.))/12.,2.));
      col+=vec3(.22,.16,.065)*gold*scales*sweep*e;
      gl_FragColor=vec4(col,1.);
    }
  `;
  function noise(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy);
    const a = hash(ix + iy * 131), b = hash(ix + 1 + iy * 131);
    const c = hash(ix + (iy + 1) * 131), d = hash(ix + 1 + (iy + 1) * 131);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  }
  function smokeTexture() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'), data = ctx.createImageData(128, 128);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const r = Math.hypot((x - 64) / 63, (y - 64) / 63);
      const n = noise(x / 23, y / 23) * .53 + noise(x / 10, y / 10) * .29 + noise(x / 4, y / 4) * .18;
      const alpha = Math.pow(clamp(1 - r), 1.4) * smooth(.2, .73, n), i = (y * 128 + x) * 4;
      data.data[i] = 219; data.data[i + 1] = 216; data.data[i + 2] = 193; data.data[i + 3] = alpha * 185;
    }
    ctx.putImageData(data, 0, 0); return canvas;
  }
  function compile(gl, type, source) {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  }
  class DragonRenderer {
    constructor(surface, atmosphere) {
      this.surface = surface; this.atmosphere = atmosphere;
      this.gl = surface.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
      if (!this.gl) throw new Error('WebGL is required for the editable composition. Use the rendered MP4 on the web.');
      this.ctx = atmosphere.getContext('2d'); this.smoke = smokeTexture(); this.ready = false;
      const gl = this.gl, program = gl.createProgram();
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      gl.useProgram(program); this.program = program;
      const vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPosition'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      this.timeUniform = gl.getUniformLocation(program, 'uTime'); this.powerUniform = gl.getUniformLocation(program, 'uPower');
    }
    async load(original, water) {
      await Promise.all([original.decode(), water.decode()]);
      const gl = this.gl;
      [original, water].forEach((img, i) => {
        const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.uniform1i(gl.getUniformLocation(this.program, i ? 'uWater' : 'uOriginal'), i);
      }); this.ready = true;
    }
    draw(seconds) {
      if (!this.ready) return;
      const t = seconds >= 5 ? 0 : clamp(seconds, 0, 5), e = power(t), gl = this.gl, c = this.ctx;
      gl.viewport(0, 0, this.surface.width, this.surface.height);
      gl.uniform1f(this.timeUniform, t); gl.uniform1f(this.powerUniform, e); gl.drawArrays(gl.TRIANGLES, 0, 6);
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.atmosphere.width, this.atmosphere.height);
      c.setTransform(this.atmosphere.width / 251, 0, 0, this.atmosphere.height / 349, -4 * this.atmosphere.width / 251, -6 * this.atmosphere.height / 349);
      c.lineCap = 'round'; c.lineJoin = 'round';
      this.backgroundLanterns(t); this.lightning(t); this.eyes(t, e); this.hornLanterns(t, e); this.breath(t, e); this.water(t, e); this.glints(t, e);
      c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    }
    glow(x, y, rx, ry, color, alpha) {
      const c = this.ctx; c.save(); c.translate(x, y); c.scale(rx, ry);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${color},${alpha})`); g.addColorStop(.32, `rgba(${color},${alpha * .42})`); g.addColorStop(1, `rgba(${color},0)`);
      c.fillStyle = g; c.fillRect(-1, -1, 2, 2); c.restore();
    }
    eyes(t, e) {
      if (!e) return;
      const c = this.ctx, dy = e * 2.8, strength = e * (.88 + .12 * Math.sin(t * 4.1) ** 2);
      c.save(); c.globalCompositeOperation = 'screen';
      for (const [x, angle] of [[114, .40], [148, -.4]]) {
        this.glow(x, 155.5 + dy, 9 + 2 * e, 6, '255,175,18', .74 * strength);
        this.glow(x, 155.5 + dy, 19, 3.1, '255,205,59', .19 * strength);
        c.save(); c.translate(x, 155.5 + dy); c.rotate(angle);
        c.fillStyle = `rgba(255,227,91,${strength * .94})`; c.beginPath(); c.ellipse(0, 0, 2.65, 1.3, 0, 0, TAU); c.fill();
        c.fillStyle = `rgba(255,249,184,${strength * .72})`; c.beginPath(); c.ellipse(0, 0, .75, 1.05, 0, 0, TAU); c.fill(); c.restore();
      } c.restore();
    }
    hornLanterns(t, e) {
      const c = this.ctx; c.save(); c.globalCompositeOperation = 'screen';
      for (const [x,y,px0,py0,angle,color] of [[75,122,83,101,.145*e*Math.sin(t*4.3),'255,119,22'],[198,122,191,102,-.135*e*Math.sin(t*4.3+.45),'129,212,237']]) {
        const x1=px0+(x-px0)*Math.cos(angle)-(y-py0)*Math.sin(angle), y1=py0+(x-px0)*Math.sin(angle)+(y-py0)*Math.cos(angle);
        this.glow(x1,y1,21,24,color,e*.30); this.glow(x1,y1,8,12,'255,207,105',e*.27);
      } c.restore();
    }
    backgroundLanterns(t) {
      const c = this.ctx;
      for (let i = 0; i < 5; i++) {
        const age=t-(.2+i*.21),life=3.5;if(age<=0||age>=life)continue;
        const a=Math.sin(age/life*Math.PI)**2*.36, x=[21,239,31,225,217][i]+1.6*Math.sin(age*1.5+i),y=[111,98,80,66,40][i]-age*(8+i);
        c.save();c.globalCompositeOperation='screen';this.glow(x,y,8,11,'255,148,42',a);
        c.globalAlpha=a;c.fillStyle='#ffb754';c.beginPath();c.ellipse(x,y,1.6,2.3,0,0,TAU);c.fill();c.restore();
      }
    }
    lightning(t) {
      const c=this.ctx,strikes=[
        {at:1.68,life:.39,points:[[220,14],[213,27],[219,32],[203,43],[212,45],[205,62],[226,69],[231,81]]},
        {at:2.60,life:.52,points:[[49,13],[38,26],[47,29],[30,43],[42,44],[27,63],[34,70],[21,85]]},
        {at:3.12,life:.43,points:[[182,12],[174,23],[182,26],[177,36],[188,39],[183,47]]}
      ];c.save();c.globalCompositeOperation='screen';
      for(const s of strikes){const age=t-s.at;if(age<0||age>s.life)continue;
        const a=smooth(0,.045,age)*(1-smooth(.07,s.life,age)),path=new Path2D();
        s.points.forEach(([x,y],i)=>{
          if(!i){path.moveTo(x,y);return;}
          const[px,py]=s.points[i-1],dx=x-px,dy=y-py,len=Math.hypot(dx,dy);
          for(let j=1;j<=5;j++){const q=j/5,n=j===5?0:(hash(i*17+j*11+s.at)-.5)*2.1;path.lineTo(px+dx*q-dy/len*n,py+dy*q+dx/len*n);}
        });
        c.strokeStyle=`rgba(255,178,64,${a*.07})`;c.lineWidth=4.5;c.stroke(path);
        c.strokeStyle=`rgba(255,205,116,${a*.4})`;c.lineWidth=1.2;c.stroke(path);
        c.strokeStyle=`rgba(255,248,211,${a*.95})`;c.lineWidth=.40;c.stroke(path);
        const[x,y]=s.points[3];c.beginPath();c.moveTo(x,y);c.lineTo(x+11,y-2);c.lineTo(x+15,y+7);c.lineTo(x+23,y+9);
        c.strokeStyle=`rgba(255,217,138,${a*.67})`;c.lineWidth=.45;c.stroke();this.glow(x,y,19,25,'255,181,51',a*.12);
      }c.restore();
    }
    breath(t,e){const c=this.ctx;c.save();c.globalCompositeOperation='screen';
      for(let i=0;i<14;i++){const age=t-(1.2+i*.13),life=1.25;if(age<0||age>life)continue;
        const p=age/life,side=i%2?1:-1,x=132+side*(5*p+29*p*p)+Math.sin(age*3+i)*p*4,y=201+e*2.8+20*p-5*p*p,size=9+p*44;
        c.globalAlpha=Math.sin(Math.PI*p)**1.2*(.80+hash(i)*.20)*bump(t,.9,1.5,3.4,4.65);
        c.save();c.translate(x,y);c.rotate(side*(p*.8+i*.9));c.scale(1.25,.75);c.drawImage(this.smoke,-size*.5,-size*.5,size,size);c.restore();
      }c.globalAlpha=1;
      for(let i=0;i<4;i++){const x=28+i*67+Math.sin(t*1.6+i)*7*e;c.globalAlpha=e*.12;c.drawImage(this.smoke,x-36,211+Math.sin(t+i)*3,72,30);}c.restore();
    }
    water(t,e){const c=this.ctx;c.save();c.beginPath();c.rect(0,218,259,141);c.clip();
      for(let k=0;k<3;k++){const age=t-(1.25+k*.5),life=1.75;if(age<0||age>life)continue;
        const p=age/life,a=Math.sin(Math.PI*p)**1.2;
        for(const side of [-1,1]){const x=130+side*(12+145*p),y=243+12*p+k*5,span=16+31*p,height=(7+7*e)*Math.sin(Math.PI*p);
          const grad=c.createLinearGradient(0,y-height,0,y+12);grad.addColorStop(0,`rgba(230,251,249,${a*.75})`);grad.addColorStop(.25,`rgba(179,234,239,${a*.26})`);grad.addColorStop(1,'rgba(85,180,205,0)');
          c.fillStyle=grad;c.beginPath();c.moveTo(x-side*span,y+11);c.bezierCurveTo(x-side*span*.55,y+2,x-side*9,y-height,x,y-height);c.bezierCurveTo(x+side*6,y-height-1,x+side*span*.50,y+5,x+side*span,y+12);c.closePath();c.fill();
          c.strokeStyle=`rgba(225,251,245,${a*.65})`;c.lineWidth=.55;c.beginPath();c.moveTo(x-side*span,y+6);c.quadraticCurveTo(x-side*6,y-height-5,x+side*span*.65,y+6);c.stroke();
          for(let j=0;j<14;j++){const r=hash(j+k*20),xx=x+side*(r-.5)*span*1.8,yy=y-height*(1-Math.abs(r-.5)*1.4)-hash(j*7+k)*4;c.fillStyle=`rgba(235,254,245,${a*(.24+r*.5)})`;c.beginPath();c.ellipse(xx,yy,.25+hash(j*9)*.7,.2+hash(j*3)*.45,0,0,TAU);c.fill();}
        }
      }
      const age=t-2.52;if(age>0&&age<1.3){const a=1-smooth(.65,1.3,age);for(let i=0;i<32;i++){const side=i%2?1:-1,r=hash(i*3),vx=side*(28+r*70),vy=-(8+hash(i*7)*28),x=130+side*16+vx*age,y=238+vy*age+25*age*age;
        c.strokeStyle=`rgba(218,249,247,${a*(.32+r*.38)})`;c.lineWidth=.3+hash(i*17)*.6;c.beginPath();c.moveTo(x,y);c.lineTo(x-vx*.014,y-(vy+50*age)*.014);c.stroke();}}
      c.globalCompositeOperation='screen';this.glow(130,240,70,9,'143,232,236',e*.18);c.restore();
    }
    glints(t,e){const c=this.ctx;c.save();c.globalCompositeOperation='screen';
      [[57,164],[202,176],[48,199],[209,201],[90,103],[174,88],[169,212]].forEach(([x,y],i)=>{const p=clamp(1-Math.abs(t-(1.25+i*.30))/.24),a=p*p*e;if(!a)return;
        this.glow(x,y,3.5,3.5,'255,218,112',a*.55);c.strokeStyle=`rgba(255,239,174,${a*.85})`;c.lineWidth=.4;c.beginPath();c.moveTo(x-2,y);c.lineTo(x+2,y);c.moveTo(x,y-3);c.lineTo(x,y+3);c.stroke();});c.restore();
    }
  }
  window.DragonRenderer=DragonRenderer;
})();
