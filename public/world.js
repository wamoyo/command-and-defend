// Static scene + unit factories. No game-logic state here.

import * as THREE from 'three'

// ----- exports filled on initWorld() -----

export var renderer = null
export var camera = null
export var scene = null
export var castle = null
export var gate = null
export var archers = []
export var wizard = null

var gateClosedY = 1
var gateOpenY   = 3.2
var gateTargetY = gateClosedY

var viewSize = 18
var aspect = 1

// ---------- init ----------

// Side effect: build renderer, scene, camera, castle, defenders, lights, ground.
export function initWorld () {
  var canvas = document.getElementById('scene')
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setClearColor(0x0a1218)
  renderer.setSize(window.innerWidth, window.innerHeight)

  scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x0a1218, 22, 56)

  aspect = window.innerWidth / window.innerHeight
  camera = new THREE.OrthographicCamera(
    -viewSize * aspect, viewSize * aspect,
    viewSize, -viewSize,
    0.1, 200
  )
  camera.position.set(0, 28, 20)
  camera.lookAt(0, 0, -2)

  window.addEventListener('resize', onResize)

  scene.add(new THREE.HemisphereLight(0xb4c7d8, 0x3a2a18, 0.85))
  var sun = new THREE.DirectionalLight(0xffeecc, 1.1)
  sun.position.set(10, 20, 10)
  scene.add(sun)

  // ground
  var ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshLambertMaterial({ color: 0x3f502c })
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  // path strip (a slightly different colored rectangle from spawn to gate)
  var path = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 30),
    new THREE.MeshLambertMaterial({ color: 0x4d3b22 })
  )
  path.rotation.x = -Math.PI / 2
  path.position.set(0, 0.01, -10)
  scene.add(path)

  buildCastle()
  buildDefenders()
}

// Side effect: reacts to window resize.
export function onResize () {
  aspect = window.innerWidth / window.innerHeight
  camera.left = -viewSize * aspect
  camera.right = viewSize * aspect
  camera.top = viewSize
  camera.bottom = -viewSize
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

// Side effect: per-frame world updates (gate slide, wizard orb bob, dragon wings).
export function tickWorld (dt) {
  if (!gate) return
  gate.position.y += (gateTargetY - gate.position.y) * Math.min(1, dt * 4)
  if (wizard && wizard.userData.orb) {
    wizard.userData.orbT = (wizard.userData.orbT || 0) + dt
    var k = 1 + Math.sin(wizard.userData.orbT * 3) * 0.05
    wizard.userData.orb.scale.setScalar(k)
  }
}

// ---------- castle ----------

// Side effect: builds castle group.
function buildCastle () {
  castle = new THREE.Group()
  castle.position.set(0, 0, 4)
  scene.add(castle)

  var wallMat = new THREE.MeshLambertMaterial({ color: 0x8a8a8a })
  addWall(wallMat, 10, 2, 0.6,  0, 1,  2)
  addWall(wallMat, 0.6, 2, 4,  -5, 1,  0)
  addWall(wallMat, 0.6, 2, 4,   5, 1,  0)
  addWall(wallMat, 3, 2, 0.6, -3.5, 1, -2)
  addWall(wallMat, 3, 2, 0.6,  3.5, 1, -2)

  var towerMat = new THREE.MeshLambertMaterial({ color: 0x6f6f6f })
  var roofMat  = new THREE.MeshLambertMaterial({ color: 0x4a2420 })
  addTower(towerMat, roofMat, -5,  2)
  addTower(towerMat, roofMat,  5,  2)
  addTower(towerMat, roofMat, -5, -2)
  addTower(towerMat, roofMat,  5, -2)

  gate = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 0.5),
    new THREE.MeshLambertMaterial({ color: 0x4a2e14 })
  )
  gate.position.set(0, gateClosedY, -2)
  castle.add(gate)
}

// Side effect: adds a box wall to the castle group.
function addWall (mat, w, h, d, x, y, z) {
  var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.position.set(x, y, z)
  castle.add(m)
}

// Side effect: adds a tower (cylinder + cone) to the castle group.
function addTower (bodyMat, roofMat, x, z) {
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 16), bodyMat)
  body.position.set(x, 1.5, z)
  var roof = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.2, 16), roofMat)
  roof.position.set(x, 3.6, z)
  castle.add(body)
  castle.add(roof)
}

// Side effect: commands gate toward open or closed.
export function setGatePosition (open) {
  gateTargetY = open ? gateOpenY : gateClosedY
}

// ---------- defenders ----------

// Side effect: builds archers and wizard.
function buildDefenders () {
  var archerBody = new THREE.MeshLambertMaterial({ color: 0x3d6bc1 })
  var archerHead = new THREE.MeshLambertMaterial({ color: 0x5a88d4 })
  addArcher(archerBody, archerHead, -2, -2)
  addArcher(archerBody, archerHead,  0, -2)
  addArcher(archerBody, archerHead,  2, -2)

  buildWizard()
}

// Side effect: places one blue archer on the front wall.
function addArcher (bodyMat, headMat, x, z) {
  var g = new THREE.Group()
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.6, 10), bodyMat)
  body.position.y = 0.3
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), headMat)
  head.position.y = 0.75
  g.add(body)
  g.add(head)
  g.position.set(x, 2.1, z)
  g.userData = { bodyMat, headMat, baseBody: bodyMat.color.clone(), baseHead: headMat.color.clone(), flashT: 0 }
  castle.add(g)
  archers.push(g)
}

// Side effect: brief yellow flash on an archer mesh (via per-instance material swap).
export function flashArcher (archer) {
  var u = archer.userData
  if (!u._mat) {
    // clone materials so we don't tint every archer
    u._mat = u.bodyMat.clone()
    u._matH = u.headMat.clone()
    archer.children[0].material = u._mat
    archer.children[1].material = u._matH
  }
  u._mat.color.set(0xffe06b)
  u._matH.color.set(0xffe06b)
  u.flashT = 0.18
}

// Side effect: decay archer flash back to blue. Called from main tick.
export function tickArcherFlashes (dt) {
  for (let i = 0; i < archers.length; i++) {
    var u = archers[i].userData
    if (u.flashT > 0) {
      u.flashT -= dt
      if (u.flashT <= 0 && u._mat) {
        u._mat.color.copy(u.baseBody)
        u._matH.color.copy(u.baseHead)
      }
    }
  }
}

// Side effect: build wizard mesh at castle center.
function buildWizard () {
  var g = new THREE.Group()
  var robe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.45, 0.9, 12),
    new THREE.MeshLambertMaterial({ color: 0x5a2e8a })
  )
  robe.position.y = 0.45
  var head = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    new THREE.MeshLambertMaterial({ color: 0xf0dcb4 })
  )
  head.position.y = 1.05
  // pointy hat
  var hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.25, 0.6, 10),
    new THREE.MeshLambertMaterial({ color: 0x5a2e8a })
  )
  hat.position.y = 1.45
  // staff
  var staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6),
    new THREE.MeshLambertMaterial({ color: 0x6b4624 })
  )
  staff.position.set(0.3, 0.8, 0)
  // glowing orb
  var orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 14, 12),
    new THREE.MeshBasicMaterial({ color: 0x8cd5ff })
  )
  orb.position.set(0.3, 1.55, 0)
  g.add(robe)
  g.add(head)
  g.add(hat)
  g.add(staff)
  g.add(orb)
  g.position.set(0, 0, 3)   // inside castle courtyard
  g.userData = { orb, orbBase: orb.material.color.clone() }
  castle.add(g)
  wizard = g
}

// Side effect: brief orb glow-up pulse.
export function pulseWizardOrb () {
  if (!wizard) return
  wizard.userData.orb.material.color.set(0xffc84a)
  setTimeout(function () {
    if (wizard) wizard.userData.orb.material.color.copy(wizard.userData.orbBase)
  }, 320)
}

// ---------- factories (used by battle.js) ----------

var arrowGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.55, 6)
var arrowMat = new THREE.MeshLambertMaterial({ color: 0x3a2a16 })

// Pure-ish: build an arrow mesh.
export function makeArrow () {
  return new THREE.Mesh(arrowGeo, arrowMat)
}

var fireballGeo = new THREE.SphereGeometry(0.35, 16, 12)

// Pure-ish: build a fireball (glowing orange sphere). Per-instance material for color animation.
export function makeFireball () {
  var mat = new THREE.MeshBasicMaterial({ color: 0xffa040 })
  return new THREE.Mesh(fireballGeo, mat)
}

// Pure-ish: build an AoE impact orb (transparent, scales up).
export function makeImpactOrb () {
  var mat = new THREE.MeshBasicMaterial({ color: 0xff7020, transparent: true, opacity: 0.7, depthWrite: false })
  var m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), mat)
  m.scale.setScalar(0.1)
  return m
}

// Pure-ish: build a gold rally pulse ring (flat, expands).
export function makeRallyPulse () {
  var mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide })
  var m = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.3, 32), mat)
  m.rotation.x = -Math.PI / 2
  m.position.set(0, 0.05, 0)
  return m
}

// Pure-ish: build a dragon fire-breath cylinder (red, transparent).
export function makeDragonFireBreath () {
  var mat = new THREE.MeshBasicMaterial({ color: 0xff5030, transparent: true, opacity: 0.85, depthWrite: false })
  var m = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.15, 4, 10), mat)
  return m
}

// ---------- enemy factories ----------

// Pure-ish: build an enemy group by type. Returns { group, meshes, flashMats }.
export function makeEnemy (type) {
  if (type === 'troll') return makeTroll()
  if (type === 'dragon') return makeDragon()
  return makeOrc()
}

function makeOrc () {
  var g = new THREE.Group()
  var bodyMat = new THREE.MeshLambertMaterial({ color: 0x9c2f2f })
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.4), bodyMat)
  body.position.y = 0.35
  var headMat = new THREE.MeshLambertMaterial({ color: 0x6b1e1e })
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), headMat)
  head.position.y = 0.9
  var eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcc22 })
  var eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat)
  eyeL.position.set(-0.09, 0.92, 0.19)
  var eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), eyeMat)
  eyeR.position.set(0.09, 0.92, 0.19)
  g.add(body, head, eyeL, eyeR)
  return { group: g, mats: [bodyMat, headMat], flashBase: [bodyMat.color.clone(), headMat.color.clone()] }
}

function makeTroll () {
  var g = new THREE.Group()
  var bodyMat = new THREE.MeshLambertMaterial({ color: 0x3d5a2a })
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.2, 0.7), bodyMat)
  body.position.y = 0.6
  var headMat = new THREE.MeshLambertMaterial({ color: 0x2d4a1a })
  var head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), headMat)
  head.position.y = 1.5
  var tuskMat = new THREE.MeshBasicMaterial({ color: 0xe8d8a0 })
  var tuskL = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), tuskMat)
  tuskL.position.set(-0.14, 1.38, 0.28)
  tuskL.rotation.x = Math.PI
  var tuskR = tuskL.clone()
  tuskR.position.x = 0.14
  g.add(body, head, tuskL, tuskR)
  return { group: g, mats: [bodyMat, headMat], flashBase: [bodyMat.color.clone(), headMat.color.clone()] }
}

function makeDragon () {
  var g = new THREE.Group()
  var bodyMat = new THREE.MeshLambertMaterial({ color: 0x701818 })
  // body = cylinder laid horizontal
  var body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 2.0, 10), bodyMat)
  body.rotation.z = Math.PI / 2
  body.position.y = 0
  var head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), bodyMat)
  head.position.set(-1.1, 0.1, 0)
  var eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe028 })
  var eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), eyeMat)
  eyeL.position.set(-1.3, 0.22, 0.18)
  var eyeR = eyeL.clone()
  eyeR.position.z = -0.18
  // wings
  var wingMat = new THREE.MeshLambertMaterial({ color: 0x3a0b0b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  var wingL = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.0), wingMat)
  wingL.position.set(0, 0.25, 0.9)
  wingL.rotation.x = Math.PI / 2
  var wingR = wingL.clone()
  wingR.position.z = -0.9
  // tail
  var tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), bodyMat)
  tail.position.set(1.1, 0, 0)
  tail.rotation.z = -Math.PI / 2
  g.add(body, head, eyeL, eyeR, wingL, wingR, tail)
  g.userData.wingL = wingL
  g.userData.wingR = wingR
  return { group: g, mats: [bodyMat], flashBase: [bodyMat.color.clone()], wings: true }
}

// Side effect: flash an enemy's body white briefly (hit indicator).
export function flashEnemyHit (enemyObj) {
  var mats = enemyObj.mats
  var bases = enemyObj.flashBase
  for (let i = 0; i < mats.length; i++) mats[i].color.set(0xffffff)
  setTimeout(function () {
    for (let i = 0; i < mats.length; i++) mats[i].color.copy(bases[i])
  }, 90)
}
