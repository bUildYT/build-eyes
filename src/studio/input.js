// bUild sTudio · INPUT: controllers and bare hands become the same two pointers (L, R).
//  pointer = { kind: 'ctrl'|'hand'|'none', pos (tool tip, world), quat, dir (forward), trig 0..1, on (trigger held), grip,
//              edges: onDown/onUp/gripDown/gripUp/aDown/bDown, stick {x,y}, stickDir edge (-1/0/1 per axis), menu (left palm up / X) }
import * as THREE from 'three';
const V3 = THREE.Vector3, Q = THREE.Quaternion;
const F = ['thumb', 'index-finger', 'middle-finger', 'ring-finger', 'pinky-finger'];
const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...F.slice(1).flatMap(f => [`${f}-phalanx-proximal`, `${f}-phalanx-intermediate`, `${f}-phalanx-distal`, `${f}-tip`])];

function blank(side) {
  return { side, kind: 'none', pos: new V3(), quat: new Q(), dir: new V3(0, 0, -1), up: new V3(0, 1, 0), trig: 0, on: false, grip: false,
    onDown: false, onUp: false, gripDown: false, gripUp: false, aDown: false, bDown: false, stickDown: false, stick: { x: 0, y: 0 }, sx: 0, sy: 0, sxEdge: 0, syEdge: 0,
    palmUp: false, ring: false, pinky: false, ringDown: false, pinkyDown: false, fist: false, curl: [1.9, 1.9, 1.9, 1.9], palm: { pos: new V3(), quat: new Q(), dir: new V3(0, 0, -1) }, pts: null, gp: null, vel: new V3(), last: new V3(), buzz() {} };
}

export function createInput() {
  const I = { L: blank('L'), R: blank('R'), sim: null };
  const prevBtn = { L: [], R: [] };
  function edges(P, on, grip, a, b, st) {
    P.onDown = on && !P.on; P.onUp = !on && P.on; P.on = on;
    P.gripDown = grip && !P.grip; P.gripUp = !grip && P.grip; P.grip = grip;
    const pb = prevBtn[P.side]; P.aDown = a && !pb[0]; P.bDown = b && !pb[1]; P.stickDown = st && !pb[2]; prevBtn[P.side] = [a, b, st];
    const ex = Math.abs(P.stick.x) > .7 ? Math.sign(P.stick.x) : Math.abs(P.stick.x) < .3 ? 0 : P.sx;
    const ey = Math.abs(P.stick.y) > .7 ? Math.sign(P.stick.y) : Math.abs(P.stick.y) < .3 ? 0 : P.sy;
    P.sxEdge = ex !== P.sx ? ex : 0; P.syEdge = ey !== P.sy ? ey : 0; P.sx = ex; P.sy = ey;
  }
  I.read = (frame, ref, dt) => {
    const seen = { L: false, R: false };
    if (frame) for (const src of frame.session.inputSources) {
      const side = src.handedness === 'left' ? 'L' : src.handedness === 'right' ? 'R' : null; if (!side || (I.sim && I.sim[side])) continue;
      const P = I[side];
      if (src.hand) {
        const pts = [];
        for (const n of JOINTS) { const j = src.hand.get(n), pose = j && frame.getJointPose(j, ref); if (!pose) break; const p = pose.transform.position; pts.push(new V3(p.x, p.y, p.z)); }
        if (pts.length !== 21) continue;
        seen[side] = true; P.kind = 'hand'; P.pts = pts; P.gp = null;
        const d = pts[4].distanceTo(pts[8]), dm = pts[4].distanceTo(pts[12]);
        P.trig = THREE.MathUtils.clamp((.05 - d) / (.05 - .012), 0, 1);
        const wr = pts[0], cu = (k, t) => pts[t].distanceTo(wr) / Math.max(.02, pts[k].distanceTo(wr)), c = P.curl = [cu(5, 8), cu(9, 12), cu(13, 16), cu(17, 20)];   // fingertip vs knuckle distance from the wrist: open ~1.9, fist < 1.2
        P.fist = P.fist ? c.filter(x => x < 1.42).length >= 3 : c.every(x => x < 1.28);
        const closing = c[1] < 1.3 && c[2] < 1.3 && c[3] < 1.3;              // a hand closing into a fist must not fire a pinch on its way
        const on = !P.fist && (P.on ? d < .034 : d < .02 && !closing);
        const grip = !on && !P.fist && !P.ring && !P.pinky && (P.grip ? dm < .04 : dm < .022 && !closing && dm <= pts[4].distanceTo(pts[16])) && d > .035;    // thumb + MIDDLE finger = pull
        const dr = pts[4].distanceTo(pts[16]), dp = pts[4].distanceTo(pts[20]), free = !on && !P.fist && !closing;
        const ring = !on && !P.fist && (P.ring ? dr < .04 : free && dr < .022 && dr < dm - .004 && dr < dp - .004 && dr < d - .004), pinky = !on && !P.fist && !ring && (P.pinky ? dp < .045 : free && dp < .024 && dp < dr - .004 && dp < dm - .004);
        P.ringDown = ring && !P.ring; P.pinkyDown = pinky && !P.pinky; P.ring = ring; P.pinky = pinky;
        P.pos.addVectors(pts[4], pts[8]).multiplyScalar(.5);
        P.dir.subVectors(pts[8], pts[5]).normalize();
        const n = new V3().crossVectors(new V3().subVectors(pts[5], pts[0]), new V3().subVectors(pts[17], pts[0])).normalize(); if (side === 'L') n.negate();
        P.up.copy(n).negate();                                               // back of the hand = up
        P.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new V3(), P.dir, P.up));
        P.palm.pos.addVectors(pts[0], pts[9]).multiplyScalar(.5); P.palm.dir.subVectors(pts[9], pts[0]).normalize(); P.palm.quat.setFromRotationMatrix(new THREE.Matrix4().lookAt(new V3(), P.palm.dir, P.up));   // a fist has no fingertip direction: the palm carries it
        P.palmUp = side === 'L' && n.y > .6;
        P.stick.x = P.stick.y = 0;
        edges(P, on, grip, false, false, false);
      } else if (src.gamepad && src.targetRaySpace) {
        const pose = frame.getPose(src.targetRaySpace, ref); if (!pose) continue;
        seen[side] = true; P.kind = 'ctrl'; P.pts = null; P.gp = src.gamepad; P.fist = false;
        const t = pose.transform; P.quat.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w);
        P.dir.set(0, 0, -1).applyQuaternion(P.quat); P.up.set(0, 1, 0).applyQuaternion(P.quat);
        P.pos.set(t.position.x, t.position.y, t.position.z).addScaledVector(P.dir, .045);   // the tip floats just in front of the controller
        const B = src.gamepad.buttons, A = src.gamepad.axes;
        P.trig = B[0] ? B[0].value : 0;
        P.stick.x = A[2] || 0; P.stick.y = -(A[3] || 0);
        edges(P, P.on ? P.trig > .05 : P.trig > .12, !!(B[1] && B[1].pressed), !!(B[4] && B[4].pressed), !!(B[5] && B[5].pressed), !!(B[3] && B[3].pressed));
        P.palmUp = false;
        const h = src.gamepad.hapticActuators && src.gamepad.hapticActuators[0];
        P.buzz = (v = .3, ms = 20) => { try { h && h.pulse(v, ms); } catch { } };
      }
    }
    // tests + the desktop preview drive the pointers directly
    if (I.sim) for (const side of ['L', 'R']) {
      const s = I.sim[side]; if (!s) continue; const P = I[side]; seen[side] = true; P.kind = s.kind || 'ctrl';
      if (s.pos) P.pos.fromArray(s.pos); if (s.quat) P.quat.fromArray(s.quat); P.dir.set(0, 0, -1).applyQuaternion(P.quat); P.up.set(0, 1, 0).applyQuaternion(P.quat);
      P.fist = !!s.fist; P.palm.pos.copy(P.pos); P.palm.quat.copy(P.quat); P.palm.dir.copy(P.dir); P.trig = s.trig || 0; P.stick.x = s.sx || 0; P.stick.y = s.sy || 0; P.palmUp = !!s.palmUp;
      edges(P, P.trig > .12, !!s.grip, !!s.a, !!s.b, !!s.st);
    }
    for (const side of ['L', 'R']) {
      const P = I[side];
      if (!seen[side]) { P.fist = P.ring = P.pinky = P.ringDown = P.pinkyDown = false; if (P.kind !== 'none') { edges(P, false, false, false, false, false); P.kind = 'none'; } else { P.onDown = P.onUp = P.gripDown = P.gripUp = P.aDown = P.bDown = false; P.sxEdge = P.syEdge = 0; } continue; }
      P.vel.subVectors(P.pos, P.last).multiplyScalar(1 / Math.max(dt, .005)); P.last.copy(P.pos);
    }
    return I;
  };
  return I;
}
