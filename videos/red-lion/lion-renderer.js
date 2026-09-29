/*
 * Hierarchical 2D puppet rig for the supplied lion artwork.
 *
 * The source pixels are cut into rigid layers. No vertex warp is applied to
 * the face or anatomy. Head is the parent bone; jaw and brows inherit its
 * transform. Mane halves and forearms follow the body on their own pivots.
 * Every rendered frame is a pure function of HyperFrames timeline time.
 */
(function () {
  'use strict';

  const W = 262;
  const H = 362;
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const smooth = (a, b, v) => {
    const q = clamp((v - a) / Math.max(0.0001, b - a));
    return q * q * (3 - 2 * q);
  };
  const pulse = (t, at, attack, decay) =>
    smooth(at, at + attack, t) * (1 - smooth(at + attack, at + attack + decay, t));
  const hash = (n) => {
    const q = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return q - Math.floor(q);
  };

  function motion(t) {
    const main = pulse(t, 0.48, 0.16, 0.54);
    const second = pulse(t, 1.22, 0.12, 0.42);
    const third = pulse(t, 1.86, 0.13, 0.58);
    const after = pulse(t, 2.58, 0.16, 0.72);
    const build = smooth(0.08, 0.42, t);
    const settle = 1 - smooth(3.15, 4.92, t);
    const envelope = build * settle;
    const power = clamp(0.18 * envelope + 0.88 * main + 0.64 * second + 0.78 * third + 0.32 * after);
    const chatter = 0.42 * Math.sin(t * 15.5) * envelope * (0.25 + power);

    return {
      main,
      second,
      third,
      after,
      power,
      envelope,
      headY: 1.2 * pulse(t, 0.08, 0.24, 0.20) - 5.8 * main - 3.8 * second - 4.9 * third - 1.7 * after + chatter,
      headX: 0.55 * Math.sin(t * 7.2) * envelope,
      headR: (0.36 * Math.sin(t * 5.2) * envelope - 0.55 * main + 0.42 * second - 0.48 * third) * DEG,
      jaw: 2.6 * main + 1.8 * second + 2.35 * third + 0.9 * after,
      brow: 2.7 * power,
      maneWave: envelope * (0.62 * Math.sin(t * 7.1) + 0.28 * Math.sin(t * 12.7)),
      pawLeft: 4.2 * main + 1.8 * second + 3.4 * third + 1.1 * after,
      pawRight: 4.0 * main + 3.0 * second + 1.8 * third + 1.2 * after,
    };
  }

  const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  function multiply(a, b) {
    return {
      a: a.a * b.a + a.c * b.b,
      b: a.b * b.a + a.d * b.b,
      c: a.a * b.c + a.c * b.d,
      d: a.b * b.c + a.d * b.d,
      e: a.a * b.e + a.c * b.f + a.e,
      f: a.b * b.e + a.d * b.f + a.f,
    };
  }
  function localMatrix(pivot, pose) {
    const r = pose.rotation || 0;
    const sx = pose.scaleX == null ? 1 : pose.scaleX;
    const sy = pose.scaleY == null ? 1 : pose.scaleY;
    const cs = Math.cos(r);
    const sn = Math.sin(r);
    return {
      a: cs * sx,
      b: sn * sx,
      c: -sn * sy,
      d: cs * sy,
      e: pivot[0] + (pose.x || 0) - cs * sx * pivot[0] + sn * sy * pivot[1],
      f: pivot[1] + (pose.y || 0) - sn * sx * pivot[0] - cs * sy * pivot[1],
    };
  }
  function transformPoint(m, x, y) {
    return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
  }
  function applyMatrix(ctx, m) {
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  function ellipse(ctx, x, y, rx, ry, rotation = 0) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rotation, 0, TAU);
    ctx.fill();
  }
  function polygon(ctx, points) {
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fill();
  }

  function makeMask(draw, feather = 1.15) {
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const c = mask.getContext('2d');
    c.filter = `blur(${feather}px)`;
    c.fillStyle = '#fff';
    draw(c);
    c.filter = 'none';
    return mask;
  }

  function makeLayer(source, drawMask, eraseMasks = []) {
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const c = layer.getContext('2d');
    c.drawImage(source, 0, 0, W, H);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(makeMask(drawMask), 0, 0);
    for (const erase of eraseMasks) {
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(makeMask(erase, 0.75), 0, 0);
    }
    c.globalCompositeOperation = 'source-over';
    return layer;
  }

  function drawLayer(ctx, layer, matrix) {
    ctx.save();
    applyMatrix(ctx, matrix);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  function rotate3d(point, ax, ay, az) {
    let [x, y, z] = point;
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    return [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az), z];
  }

  const cubeVertices = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
  ];
  const cubeFaces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3],
    [5, 1, 2, 6], [0, 1, 5, 4], [7, 6, 2, 3],
  ];

  class LionRenderer {
    constructor(surface, effects) {
      this.surface = surface;
      this.effects = effects;
      this.surfaceCtx = surface.getContext('2d');
      this.effectsCtx = effects.getContext('2d');
      this.rigCanvas = document.createElement('canvas');
      this.rigCanvas.width = W;
      this.rigCanvas.height = H;
      this.rigCtx = this.rigCanvas.getContext('2d');
      this.shineCanvas = document.createElement('canvas');
      this.shineCanvas.width = W;
      this.shineCanvas.height = H;
      this.ready = false;
    }

    async load(reference, plate, symbols) {
      await Promise.all([reference, plate, ...symbols].map((image) => image.decode()));
      this.reference = reference;
      this.plate = plate;
      this.layers = this.buildLayers(reference);
      this.textures = symbols.map((image) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 192;
        const c = canvas.getContext('2d');
        const g = c.createLinearGradient(0, 0, 170, 192);
        g.addColorStop(0, '#fffbee');
        g.addColorStop(0.65, '#ffefce');
        g.addColorStop(1, '#d7af70');
        c.fillStyle = g;
        c.fillRect(0, 0, 192, 192);
        c.strokeStyle = '#e0b87c';
        c.lineWidth = 6;
        c.strokeRect(3, 3, 186, 186);
        c.drawImage(image, 17, 17, 158, 158);
        return canvas;
      });
      this.ready = true;
    }

    buildLayers(source) {
      const eraseHeadCenter = (c) => ellipse(c, 131, 94, 70, 78);
      const eraseJaw = (c) => ellipse(c, 131, 137, 47, 31, -0.01);
      const eraseLeftBrow = (c) => ellipse(c, 100, 87, 31, 20, -0.15);
      const eraseRightBrow = (c) => ellipse(c, 162, 87, 31, 20, 0.15);
      return {
        maneLeft: makeLayer(source, (c) => {
          ellipse(c, 67, 96, 54, 84, -0.06);
          polygon(c, [[28, 35], [78, 16], [113, 55], [105, 151], [43, 180], [20, 128]]);
        }, [eraseHeadCenter]),
        maneRight: makeLayer(source, (c) => {
          ellipse(c, 195, 96, 54, 84, 0.06);
          polygon(c, [[234, 35], [184, 16], [149, 55], [157, 151], [219, 180], [242, 128]]);
        }, [eraseHeadCenter]),
        armLeft: makeLayer(source, (c) => {
          polygon(c, [[9, 135], [63, 121], [99, 151], [105, 183], [81, 213], [23, 235], [4, 196]]);
          ellipse(c, 51, 181, 48, 57, -0.22);
        }),
        armRight: makeLayer(source, (c) => {
          polygon(c, [[253, 132], [201, 119], [166, 150], [160, 184], [184, 213], [239, 232], [258, 193]]);
          ellipse(c, 211, 179, 47, 57, 0.22);
        }),
        head: makeLayer(source, (c) => {
          ellipse(c, 131, 91, 72, 73);
          polygon(c, [[78, 24], [104, 10], [131, 28], [158, 9], [185, 25], [204, 78], [192, 129], [168, 153], [94, 153], [69, 128], [58, 78]]);
        }, [eraseJaw, eraseLeftBrow, eraseRightBrow]),
        jaw: makeLayer(source, (c) => {
          ellipse(c, 131, 138, 50, 34, -0.01);
          polygon(c, [[91, 119], [171, 119], [177, 151], [157, 174], [104, 174], [85, 150]]);
        }),
        browLeft: makeLayer(source, eraseLeftBrow),
        browRight: makeLayer(source, eraseRightBrow),
        border: makeLayer(source, (c) => {
          c.fillRect(0, 0, W, 8);
          c.fillRect(0, H - 8, W, 8);
          c.fillRect(0, 0, 8, H);
          c.fillRect(W - 8, 0, 8, H);
        }),
      };
    }

    pose(m) {
      const root = IDENTITY;
      const maneLeft = multiply(root, localMatrix([93, 146], {
        x: -0.5 * m.power,
        y: -0.5 * m.power,
        rotation: (-1.05 * m.maneWave - 0.55 * m.main + 0.35 * m.third) * DEG,
      }));
      const maneRight = multiply(root, localMatrix([169, 146], {
        x: 0.5 * m.power,
        y: -0.45 * m.power,
        rotation: (1.0 * m.maneWave + 0.5 * m.main - 0.32 * m.third) * DEG,
      }));
      const armLeft = multiply(root, localMatrix([79, 156], {
        x: -0.4 * m.pawLeft,
        y: -0.9 * m.pawLeft,
        rotation: -0.78 * m.pawLeft * DEG,
      }));
      const armRight = multiply(root, localMatrix([183, 156], {
        x: 0.4 * m.pawRight,
        y: -0.9 * m.pawRight,
        rotation: 0.78 * m.pawRight * DEG,
      }));
      const head = multiply(root, localMatrix([131, 145], {
        x: m.headX,
        y: m.headY,
        rotation: m.headR,
      }));
      const jaw = multiply(head, localMatrix([131, 119], {
        y: m.jaw,
        rotation: 0.42 * m.jaw * DEG,
      }));
      const browLeft = multiply(head, localMatrix([112, 98], {
        x: 0.34 * m.brow,
        y: -0.65 * m.brow,
        rotation: -1.05 * m.brow * DEG,
      }));
      const browRight = multiply(head, localMatrix([150, 98], {
        x: -0.34 * m.brow,
        y: -0.65 * m.brow,
        rotation: 1.05 * m.brow * DEG,
      }));
      return { maneLeft, maneRight, armLeft, armRight, head, jaw, browLeft, browRight };
    }

    draw(seconds) {
      if (!this.ready) return;
      const t = seconds >= 5 ? 0 : Math.max(0, seconds);
      const m = motion(t);
      const bones = this.pose(m);
      const surface = this.surfaceCtx;
      const effects = this.effectsCtx;

      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.clearRect(0, 0, this.surface.width, this.surface.height);
      surface.drawImage(this.plate, 0, 0, this.surface.width, this.surface.height);

      const rig = this.rigCtx;
      rig.setTransform(1, 0, 0, 1, 0, 0);
      rig.clearRect(0, 0, W, H);
      drawLayer(rig, this.layers.maneLeft, bones.maneLeft);
      drawLayer(rig, this.layers.maneRight, bones.maneRight);
      drawLayer(rig, this.layers.armLeft, bones.armLeft);
      drawLayer(rig, this.layers.armRight, bones.armRight);
      drawLayer(rig, this.layers.head, bones.head);
      drawLayer(rig, this.layers.jaw, bones.jaw);
      drawLayer(rig, this.layers.browLeft, bones.browLeft);
      drawLayer(rig, this.layers.browRight, bones.browRight);

      surface.save();
      surface.scale(this.surface.width / W, this.surface.height / H);
      surface.drawImage(this.rigCanvas, 0, 0);
      this.drawShimmer(surface, t, m);
      surface.drawImage(this.layers.border, 0, 0);
      surface.restore();

      effects.setTransform(1, 0, 0, 1, 0, 0);
      effects.clearRect(0, 0, this.effects.width, this.effects.height);
      effects.save();
      effects.scale(this.effects.width / W, this.effects.height / H);
      this.mist(effects, t, m);
      this.rings(effects, t, m, false);
      this.dice(effects, t, m);
      this.rings(effects, t, m, true);
      this.coins(effects, t, m);
      this.eyes(effects, m, bones.head);
      effects.restore();
      effects.globalAlpha = 1;
      effects.globalCompositeOperation = 'source-over';
    }

    drawShimmer(ctx, t, m) {
      const shine = this.shineCanvas.getContext('2d');
      shine.setTransform(1, 0, 0, 1, 0, 0);
      shine.clearRect(0, 0, W, H);
      const travel = (t / 5) * 420 - 105;
      const g = shine.createLinearGradient(travel - 16, 0, travel + 16, 0);
      g.addColorStop(0, 'rgba(255,230,128,0)');
      g.addColorStop(0.5, `rgba(255,242,179,${0.12 + 0.14 * m.power})`);
      g.addColorStop(1, 'rgba(255,230,128,0)');
      shine.fillStyle = g;
      shine.fillRect(0, 128, W, 112);
      shine.globalCompositeOperation = 'destination-in';
      shine.drawImage(this.rigCanvas, 0, 0);
      shine.globalCompositeOperation = 'source-over';
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(this.shineCanvas, 0, 0);
      ctx.restore();
    }

    glow(ctx, x, y, rx, ry, color, alpha) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(rx, ry);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, `rgba(${color},${alpha})`);
      g.addColorStop(0.35, `rgba(${color},${alpha * 0.4})`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    eyes(ctx, m, headMatrix) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      [[99, 96, 0.26], [157, 96, -0.26]].forEach(([x, y, angle]) => {
        const p = transformPoint(headMatrix, x, y);
        this.glow(ctx, p[0], p[1], 13, 7, '255,18,100', m.power * 0.88);
        this.glow(ctx, p[0], p[1], 25, 2.2, '255,68,134', m.power * 0.48);
        ctx.fillStyle = `rgba(255,183,210,${m.power * 0.9})`;
        ctx.beginPath();
        ctx.ellipse(p[0], p[1], 3.2, 1.25, angle + m.headR, 0, TAU);
        ctx.fill();
      });
      ctx.restore();
    }

    mist(ctx, t, m) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let i = 0; i < 7; i++) {
        const x = 35 + i * 32 + 7 * m.envelope * Math.sin(t * 2 + i);
        const y = 286 + 18 * Math.sin(i * 3) + m.envelope * 5 * Math.cos(t * 3 + i);
        this.glow(ctx, x, y, 38, 12, '181,22,54', 0.055 + 0.055 * m.power);
      }
      this.glow(ctx, 132, 232, 74, 54, '255,154,37', m.power * 0.15);
      ctx.restore();
    }

    rings(ctx, t, m, front) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const spin = TAU * (t / 5 + 0.11 * Math.sin(TAU * t / 5));
      for (let j = 0; j < 2; j++) {
        const radius = 98 + j * 9 + 3 * m.power;
        const ry = 19 + j * 3;
        const tilt = j ? -0.16 : 0.1;
        const a0 = front ? 0 : Math.PI;
        const a1 = front ? Math.PI : TAU;
        ctx.save();
        ctx.translate(131, 232 + j * 8);
        ctx.rotate(tilt);
        const alpha = 0.08 + 0.38 * m.power;
        ctx.strokeStyle = `rgba(255,165,36,${alpha * 0.24})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.ellipse(0, 0, radius, ry, 0, a0, a1);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255,223,120,${alpha})`;
        ctx.lineWidth = 0.9;
        ctx.stroke();
        for (let k = 0; k < 2; k++) {
          const angle = (spin * (j ? 2 : 1) + k * Math.PI + j * 1.6) % TAU;
          if ((front && angle < Math.PI) || (!front && angle >= Math.PI)) {
            ctx.strokeStyle = `rgba(255,239,183,${0.28 + 0.62 * m.power})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.ellipse(0, 0, radius, ry, 0, angle, Math.min(angle + 0.38, a1));
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      ctx.restore();
    }

    texturedTriangle(ctx, image, uv, p) {
      const [s0, s1, s2] = uv;
      const [d0, d1, d2] = p;
      const det = s0[0] * (s1[1] - s2[1]) + s1[0] * (s2[1] - s0[1]) + s2[0] * (s0[1] - s1[1]);
      if (Math.abs(det) < 0.001) return;
      const a = (d0[0] * (s1[1] - s2[1]) + d1[0] * (s2[1] - s0[1]) + d2[0] * (s0[1] - s1[1])) / det;
      const b = (d0[1] * (s1[1] - s2[1]) + d1[1] * (s2[1] - s0[1]) + d2[1] * (s0[1] - s1[1])) / det;
      const c = (d0[0] * (s2[0] - s1[0]) + d1[0] * (s0[0] - s2[0]) + d2[0] * (s1[0] - s0[0])) / det;
      const d = (d0[1] * (s2[0] - s1[0]) + d1[1] * (s0[0] - s2[0]) + d2[1] * (s1[0] - s0[0])) / det;
      const e = d0[0] - a * s0[0] - c * s0[1];
      const f = d0[1] - b * s0[0] - d * s0[1];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(...d0);
      ctx.lineTo(...d1);
      ctx.lineTo(...d2);
      ctx.closePath();
      ctx.clip();
      ctx.transform(a, b, c, d, e, f);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }

    dice(ctx, t, m) {
      const q = smooth(0, 5, t);
      const turn = TAU * q;
      const positions = [[104, 210], [160, 213], [132, 246]];
      for (let i = 0; i < 3; i++) {
        const [bx, by] = positions[i];
        const jump = m.envelope * (5 + 12 * Math.sin(t * 4.3 + i * 0.7) ** 2);
        const x = bx + m.envelope * 3 * Math.sin(t * 5 + i);
        const y = by - jump;
        this.glow(ctx, bx, by + 19, 19, 4, '62,22,4', 0.65);
        const angles = [
          -0.42 + turn * (i === 1 ? -2 : 2),
          0.5 + turn * (i === 2 ? 2 : -2) + i * 0.45,
          0.16 + turn * (i === 1 ? 1 : -1),
        ];
        const verts = cubeVertices.map((v) => rotate3d(v, ...angles));
        const project = (v) => {
          const z = 1 / (1 - v[2] * 0.1);
          return [x + v[0] * 14 * z, y + v[1] * 14 * z];
        };
        const order = cubeFaces
          .map((ids, index) => ({ ids, index, z: ids.reduce((value, key) => value + verts[key][2], 0) / 4 }))
          .sort((a, b) => a.z - b.z);
        for (const face of order) {
          const p = face.ids.map((key) => project(verts[key]));
          const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
          if (cross <= 0) continue;
          const texture = this.textures[(face.index + i * 2) % 6];
          const v = face.ids.map((key) => verts[key]);
          const point = (u, w) => project([0, 1, 2].map((n) =>
            v[0][n] * (1 - u) * (1 - w) + v[1][n] * u * (1 - w) + v[2][n] * u * w + v[3][n] * (1 - u) * w));
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const u = sx / 3;
              const w = sy / 3;
              const U = (sx + 1) / 3;
              const V = (sy + 1) / 3;
              const pp = [point(u, w), point(U, w), point(U, V), point(u, V)];
              const uv = [[u * 192, w * 192], [U * 192, w * 192], [U * 192, V * 192], [u * 192, V * 192]];
              this.texturedTriangle(ctx, texture, [uv[0], uv[1], uv[2]], [pp[0], pp[1], pp[2]]);
              this.texturedTriangle(ctx, texture, [uv[0], uv[2], uv[3]], [pp[0], pp[2], pp[3]]);
            }
          }
          ctx.beginPath();
          p.forEach((pointValue, index) => (index ? ctx.lineTo(...pointValue) : ctx.moveTo(...pointValue)));
          ctx.closePath();
          ctx.fillStyle = `rgba(72,28,8,${clamp((1 - face.z) * 0.12)})`;
          ctx.fill();
          ctx.strokeStyle = '#ceab71';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }

    coins(ctx, t, m) {
      for (let event = 0; event < 3; event++) {
        for (let i = 0; i < 5; i++) {
          const age = t - (0.64 + event * 0.68 + i * 0.025);
          const life = 1.16;
          if (age <= 0 || age >= life) continue;
          const side = i % 2 ? 1 : -1;
          const vx = side * (34 + hash(i + event * 19) * 31);
          const vy = -77 - hash(i * 7 + event) * 29;
          const x = 131 + side * 45 + vx * age;
          const y = 234 + vy * age + 78 * age * age;
          if (x < 10 || x > 252) continue;
          const alpha = smooth(0, 0.09, age) * (1 - smooth(0.76, life, age));
          ctx.save();
          ctx.globalAlpha = alpha * (0.62 + 0.22 * m.power);
          ctx.translate(x, y);
          ctx.rotate(side * age * 3 + i);
          ctx.scale(0.22 + 0.78 * Math.abs(Math.cos(age * 7 + i)), 1);
          const g = ctx.createLinearGradient(-4, -5, 4, 5);
          g.addColorStop(0, '#fff3b5');
          g.addColorStop(0.45, '#eeb344');
          g.addColorStop(1, '#8d4a0e');
          ctx.fillStyle = g;
          ctx.strokeStyle = '#f7d97e';
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.ellipse(0, 0, 4, 5, 0, 0, TAU);
          ctx.fill();
          ctx.stroke();
          ctx.strokeRect(-1, -1.2, 2, 2.4);
          ctx.restore();
        }
      }
    }
  }

  window.LionRenderer = LionRenderer;
})();
