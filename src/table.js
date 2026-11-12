// bUild eYes — ONE table frame for every EYE (headset, phone, laptop cam, tablet cam).
// The anchor everybody shares is a plain A4 sheet lying LANDSCAPE on the real table, with "1" and "2" written
// in the two corners of the long edge that faces the player:
//
//          far edge
//     +-----------------+
//     |                 |        table frame: origin = sheet centre, metres, y UP,
//     |        0        |        +X = from corner 1 to corner 2, +Z = towards the player (out of the near edge)
//     |                 |
//     1-----------------2        corner 1 = (-0.1485, 0, +0.105)   corner 2 = (+0.1485, 0, +0.105)
//          near edge (player)
//
// Every device measures corner 1 and corner 2 in ITS OWN tracking space (headset: fingertip; phone: aim + tap;
// fixed camera: the sheet finder) → the same two points → the same table, to about a centimetre.
import * as THREE from 'three';
export const A4 = [0.297, 0.210];
export const CORNER = [new THREE.Vector3(-A4[0] / 2, 0, A4[1] / 2), new THREE.Vector3(A4[0] / 2, 0, A4[1] / 2)];

// c1, c2: corner 1 and corner 2 in world space (y = up). Returns where the table group must sit + how wrong the paper measured.
export function frameFromCorners(c1, c2, lift = 0) {
  const d = new THREE.Vector3().subVectors(c2, c1); d.y = 0;
  const measured = d.length(); d.normalize();
  const yaw = Math.atan2(-d.z, d.x);                                   // local +X → d
  const z = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));        // local +Z in world
  const mid = new THREE.Vector3().addVectors(c1, c2).multiplyScalar(.5);
  const pos = mid.addScaledVector(z, -A4[1] / 2); pos.y = (c1.y + c2.y) / 2 - lift;
  return { pos, yaw, measured, err: measured - A4[0], tilt: Math.abs(c1.y - c2.y) };
}
export function applyFrame(group, f) {
  group.position.copy(f.pos); group.rotation.set(0, f.yaw, 0); group.updateMatrixWorld(true);
}
// a frame with no paper: centre + facing (solo play on a detected table plane)
export function frameAt(centre, faceTowards) {
  const yaw = Math.atan2(faceTowards.x - centre.x, faceTowards.z - centre.z);   // local +Z looks at the player
  return { pos: centre.clone(), yaw, measured: 0, err: 0, tilt: 0 };
}
