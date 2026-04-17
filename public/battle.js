// Battle dynamics: enemies, arrows, fireballs, waves, hit detection.

import * as THREE from 'three'
import {
  scene, archers, wizard, castle,
  makeArrow, makeFireball, makeImpactOrb, makeRallyPulse, makeDragonFireBreath,
  makeEnemy, flashArcher, pulseWizardOrb, flashEnemyHit, tickArcherFlashes
} from './world.js'
import {
  state, setPhase, bumpMorale, damage, winGame, showWaveBanner, updateHud
} from './game.js'

// ---------- dynamic arrays ----------

var enemies = []       // { obj, type, hp, speed, reachZ, ai?, mesh }
var arrows  = []       // { mesh, vel, power }
var fireballs = []     // { mesh, start, apex, target, t, dur, targetType, targetObj }
var orbs    = []       // { mesh, t, dur }
var pulses  = []       // { mesh, t, dur }
var breaths = []       // { mesh, t, dur }

// ---------- caps ----------

var MAX_ARROWS = 200
var MAX_FIREBALLS = 6
var MAX_ENEMIES = 40

// ---------- tuning ----------

var ENEMY_SPAWN_Z = -22
var GATE_REACH_Z  = 2
var DRAGON_Y      = 3.5

// ---------- public API ----------

// Side effect: clear all dynamic objects (used on LOSE/WIN/restart).
export function clearBattle () {
  for (let i = 0; i < enemies.length; i++) scene.remove(enemies[i].group)
  for (let i = 0; i < arrows.length; i++) scene.remove(arrows[i].mesh)
  for (let i = 0; i < fireballs.length; i++) scene.remove(fireballs[i].mesh)
  for (let i = 0; i < orbs.length; i++) scene.remove(orbs[i].mesh)
  for (let i = 0; i < pulses.length; i++) scene.remove(pulses[i].mesh)
  for (let i = 0; i < breaths.length; i++) scene.remove(breaths[i].mesh)
  enemies = []; arrows = []; fireballs = []; orbs = []; pulses = []; breaths = []
}

// Pure: remaining live-enemy count.
export function enemyCount () { return enemies.length }

// ---------- enemies ----------

// Pure: build an enemy record (HP / speed / damage by type).
function enemyStats (type) {
  if (type === 'troll') return { hp: 3, speed: 0.7, reachDmg: 20, arrowMult: 1.0 }
  if (type === 'dragon') return { hp: 20, speed: 0.9, reachDmg: 0, arrowMult: 0.5 }
  return { hp: 1, speed: 1.2, reachDmg: 10, arrowMult: 1.0 }
}

// Side effect: spawn one enemy of given type at a lateral offset.
function spawnOne (type, xHint) {
  if (enemies.length >= MAX_ENEMIES) return
  var built = makeEnemy(type)
  var stats = enemyStats(type)
  var x = typeof xHint === 'number' ? xHint : (Math.random() * 8 - 4)
  var y = (type === 'dragon') ? DRAGON_Y : 0
  built.group.position.set(x, y, ENEMY_SPAWN_Z)
  scene.add(built.group)
  var rec = {
    type,
    group: built.group,
    mats: built.mats,
    flashBase: built.flashBase,
    hp: stats.hp,
    speed: stats.speed,
    reachDmg: stats.reachDmg,
    arrowMult: stats.arrowMult,
    wings: !!built.wings,
    wingPhase: Math.random() * Math.PI * 2,
    aiState: type === 'dragon' ? 'approach' : 'march',
    breathCooldown: 0
  }
  enemies.push(rec)
}

// Side effect: public spawn via tool (sandbox). type?: 'orc'|'troll'|'dragon'. count?: 1-10.
export function spawnEnemies (type, count) {
  var n = Math.max(1, Math.min(10, count || 3))
  var t = (type === 'troll' || type === 'dragon') ? type : 'orc'
  if (enemies.length + n > MAX_ENEMIES) n = Math.max(0, MAX_ENEMIES - enemies.length)
  var xs = spread(n, Math.min(8, Math.max(2, n)))
  for (let i = 0; i < n; i++) spawnOne(t, xs[i])
  return n
}

// Pure: N evenly-spread x coords across width.
function spread (n, width) {
  if (n <= 1) return [0]
  var step = width / (n - 1)
  var out = []
  for (let i = 0; i < n; i++) out.push(-width / 2 + i * step)
  return out
}

// ---------- waves ----------

var waveSchedule = null     // array of { at: ms, type: 'orc'|... }
var waveElapsed  = 0
var waveSpawnIdx = 0
var waveBreakUntil = 0

// Pure: build an even schedule for a {type:count} pack over duration seconds.
function pack (type, count, duration) {
  if (count === 0) return []
  var list = []
  var step = duration * 1000 / count
  for (let i = 0; i < count; i++) list.push({ type, at: Math.round(i * step + 200) })
  return list
}

// Pure: sort a combined wave schedule by time.
function mergeSchedules () {
  var all = []
  for (let i = 0; i < arguments.length; i++) all = all.concat(arguments[i])
  all.sort( (a, b) => a.at - b.at )
  return all
}

// Pure: wave schedules.
function waveForIndex (i) {
  if (i === 1) return pack('orc', 7, 10)
  if (i === 2) return mergeSchedules( pack('orc', 5, 18), pack('troll', 2, 18) )
  if (i === 3) return mergeSchedules( pack('orc', 6, 28), pack('troll', 3, 28), pack('dragon', 1, 10) )
  return []
}

// Side effect: kick off the battle - starts wave 1.
export function startBattle () {
  setPhase('BATTLE')
  state.hp = state.maxHp
  updateHud()
  queueNextWave()
}

// Side effect: schedule the next wave (with a banner beat).
function queueNextWave () {
  if (state.wave >= state.totalWaves) {
    winGame()
    return
  }
  state.wave++
  updateHud()
  showWaveBanner('WAVE ' + state.wave + ' incoming...', 3800)
  waveBreakUntil = performance.now() + 2200
  setTimeout(function () {
    waveSchedule = waveForIndex(state.wave)
    waveElapsed = 0
    waveSpawnIdx = 0
  }, 2200)
}

// Side effect: tick the wave spawner.
function tickSpawner (dt) {
  if (!waveSchedule) return
  waveElapsed += dt * 1000
  while (waveSpawnIdx < waveSchedule.length && waveSchedule[waveSpawnIdx].at <= waveElapsed) {
    spawnOne(waveSchedule[waveSpawnIdx].type)
    waveSpawnIdx++
  }
  // wave complete?
  if (waveSpawnIdx >= waveSchedule.length && enemies.length === 0) {
    waveSchedule = null
    showWaveBanner('Wave ' + state.wave + ' cleared!', 1600)
    bumpMorale(5)
    setTimeout(queueNextWave, 1800)
  }
}

// ---------- fire_arrows ----------

// Pure: pick a target enemy matching filter, else nearest, else null.
function pickTarget (filter) {
  var list = enemies
  if (filter === 'trolls') list = enemies.filter( e => e.type === 'troll' )
  else if (filter === 'dragons') list = enemies.filter( e => e.type === 'dragon' )
  if (list.length === 0) list = enemies
  if (list.length === 0) return null
  // nearest to castle (highest z)
  list.sort( (a, b) => b.group.position.z - a.group.position.z )
  return list[0]
}

// Side effect: each archer shoots one arrow, with morale-based aim jitter.
export function fireArrows (filter) {
  if (arrows.length >= MAX_ARROWS) return
  var target = pickTarget(filter)
  var sigma = 0.5 * (1 - state.morale / 100)
  for (let i = 0; i < archers.length; i++) {
    var a = archers[i]
    flashArcher(a)
    var arrow = makeArrow()
    var start = new THREE.Vector3()
    a.getWorldPosition(start)
    start.y += 0.4
    start.z -= 0.3
    arrow.position.copy(start)

    var tgtPos = null
    if (target) {
      tgtPos = new THREE.Vector3()
      target.group.getWorldPosition(tgtPos)
    }
    var dir = new THREE.Vector3()
    if (tgtPos) dir.subVectors(tgtPos, start)
    else dir.set(0, 0, -20)
    dir.normalize()

    // morale aim jitter on the horizontal plane
    var jitterYaw = gaussian() * sigma
    var jitterPitch = gaussian() * sigma * 0.5
    var yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), jitterYaw)
    var pitchAxis = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0,1,0)).normalize()
    var pitchQ = new THREE.Quaternion().setFromAxisAngle(pitchAxis, jitterPitch)
    dir.applyQuaternion(yawQ).applyQuaternion(pitchQ)

    var speed = 16
    var vel = dir.multiplyScalar(speed)
    // boost vy when shooting at flying targets so arrows reach Y=3.5
    var boost = 3
    if (tgtPos && tgtPos.y > 1) boost += tgtPos.y * 0.9
    vel.y += boost

    scene.add(arrow)
    arrows.push({ mesh: arrow, vel, power: 1 })
  }
}

// Pure: simple Box-Muller gaussian.
function gaussian () {
  var u = 1 - Math.random()
  var v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// ---------- cast_fireball ----------

// Side effect: cast a fireball from the wizard toward a target cluster.
export function castFireball (filter) {
  if (fireballs.length >= MAX_FIREBALLS || !wizard) return
  pulseWizardOrb()
  var target = pickTarget(filter)
  var wp = new THREE.Vector3()
  wizard.userData.orb.getWorldPosition(wp)
  var tp
  if (target) {
    tp = new THREE.Vector3()
    target.group.getWorldPosition(tp)
  } else {
    tp = new THREE.Vector3(0, 0, -8)
  }
  var mid = wp.clone().lerp(tp, 0.5)
  mid.y += 3.5  // bezier apex
  var fb = makeFireball()
  fb.position.copy(wp)
  scene.add(fb)
  fireballs.push({
    mesh: fb,
    start: wp,
    apex: mid,
    target: tp,
    targetObj: target || null,
    t: 0,
    dur: 0.95
  })
}

// ---------- rally pulse ----------

// Side effect: spawn a gold expanding ring at castle origin.
export function spawnRallyPulse () {
  var p = makeRallyPulse()
  castle.add(p)
  pulses.push({ mesh: p, t: 0, dur: 0.9, inCastle: true })
}

// ---------- per-frame tick ----------

// Side effect: advance all battle objects.
export function tickBattle (dt) {
  tickArcherFlashes(dt)
  if (state.phase === 'BATTLE') tickSpawner(dt)
  tickEnemies(dt)
  tickArrows(dt)
  tickFireballs(dt)
  tickOrbs(dt)
  tickPulses(dt)
  tickBreaths(dt)
}

// Side effect: move enemies; damage castle on reach; handle dragon AI.
function tickEnemies (dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    var e = enemies[i]
    if (e.wings) {
      e.wingPhase += dt * 6
      var w = Math.sin(e.wingPhase) * 0.6
      e.group.userData.wingL.rotation.x = Math.PI / 2 + w
      e.group.userData.wingR.rotation.x = Math.PI / 2 - w
    }

    if (e.type === 'dragon') tickDragonAi(e, dt)
    else {
      // walk straight
      e.group.position.z += e.speed * dt
      e.group.position.y = Math.abs(Math.sin((e.group.position.z + i) * 3)) * 0.05
    }

    // reach the gate?
    if (e.type !== 'dragon' && e.group.position.z >= GATE_REACH_Z) {
      damage(e.reachDmg)
      scene.remove(e.group)
      enemies.splice(i, 1)
    }
  }
}

// Side effect: dragon state machine (approach -> attack -> retreat -> approach).
function tickDragonAi (e, dt) {
  var castleZ = 3  // roughly
  var dz = castleZ - e.group.position.z
  if (e.aiState === 'approach') {
    e.group.position.z += e.speed * dt * 1.2
    if (dz < 8) e.aiState = 'attack'
  } else if (e.aiState === 'attack') {
    // hover + bob
    e.group.position.y = DRAGON_Y + Math.sin(performance.now() * 0.003) * 0.2
    e.breathCooldown -= dt
    if (e.breathCooldown <= 0) {
      breatheFire(e)
      e.breathCooldown = 3.0
    }
    // retreat after a while
    e._atkT = (e._atkT || 0) + dt
    if (e._atkT > 10) { e.aiState = 'retreat'; e._atkT = 0 }
  } else if (e.aiState === 'retreat') {
    e.group.position.z -= e.speed * dt * 1.5
    if (e.group.position.z < ENEMY_SPAWN_Z + 2) {
      e.aiState = 'approach'
    }
  }
}

// Side effect: spawn a fire-breath visual and damage castle.
function breatheFire (dragon) {
  var from = new THREE.Vector3()
  dragon.group.getWorldPosition(from)
  from.x -= 1.3   // head offset
  var to = new THREE.Vector3(0, 1.5, 3)  // castle center-ish
  var mid = from.clone().lerp(to, 0.5)
  var dir = to.clone().sub(from)
  var len = dir.length()
  var m = makeDragonFireBreath()
  m.position.copy(mid)
  // orient cylinder along dir; default cylinder axis is Y
  var quat = new THREE.Quaternion()
  var up = new THREE.Vector3(0, 1, 0)
  quat.setFromUnitVectors(up, dir.clone().normalize())
  m.quaternion.copy(quat)
  m.scale.y = len / 4
  scene.add(m)
  breaths.push({ mesh: m, t: 0, dur: 0.5 })
  damage(20)
}

// Side effect: advance arrows, hit-test, cull.
function tickArrows (dt) {
  for (let j = arrows.length - 1; j >= 0; j--) {
    var ar = arrows[j]
    ar.vel.y -= 9.8 * dt
    ar.mesh.position.x += ar.vel.x * dt
    ar.mesh.position.y += ar.vel.y * dt
    ar.mesh.position.z += ar.vel.z * dt
    // orient along velocity
    var look = new THREE.Vector3(
      ar.mesh.position.x + ar.vel.x,
      ar.mesh.position.y + ar.vel.y,
      ar.mesh.position.z + ar.vel.z
    )
    ar.mesh.lookAt(look)
    ar.mesh.rotateX(Math.PI / 2)
    // hit test
    var hit = false
    for (let k = enemies.length - 1; k >= 0 && !hit; k--) {
      var e = enemies[k]
      var ep = e.group.position
      var ap = ar.mesh.position
      var dx = ep.x - ap.x
      var dy = (ep.y + (e.type === 'dragon' ? 0.2 : 0.5)) - ap.y
      var dz = ep.z - ap.z
      var r2 = (e.type === 'dragon') ? 1.3 : 0.7
      if (dx * dx + dy * dy + dz * dz < r2) {
        damageEnemy(k, ar.power * e.arrowMult)
        hit = true
      }
    }
    // cull
    if (hit || ar.mesh.position.y < 0 || ar.mesh.position.z < -30 || Math.abs(ar.mesh.position.x) > 30) {
      scene.remove(ar.mesh)
      arrows.splice(j, 1)
    }
  }
  // oldest-first cap enforcement (defensive)
  while (arrows.length > MAX_ARROWS) {
    var old = arrows.shift()
    scene.remove(old.mesh)
  }
}

// Side effect: advance fireball along bezier; on arrival spawn impact orb with AoE damage.
function tickFireballs (dt) {
  for (let i = fireballs.length - 1; i >= 0; i--) {
    var fb = fireballs[i]
    fb.t += dt
    var k = Math.min(1, fb.t / fb.dur)
    // quadratic bezier: (1-k)^2*A + 2(1-k)k*B + k^2*C
    var a = 1 - k
    var p = new THREE.Vector3()
    p.copy(fb.start).multiplyScalar(a * a)
    p.add(new THREE.Vector3().copy(fb.apex).multiplyScalar(2 * a * k))
    p.add(new THREE.Vector3().copy(fb.target).multiplyScalar(k * k))
    fb.mesh.position.copy(p)
    if (k >= 1) {
      // AoE impact
      aoeExplode(fb.target, 3.0, 3)
      scene.remove(fb.mesh)
      fireballs.splice(i, 1)
    }
  }
}

// Side effect: apply AoE damage to enemies near `center` within radius; spawn impact orb.
function aoeExplode (center, radius, dmg) {
  var orb = makeImpactOrb()
  orb.position.copy(center)
  scene.add(orb)
  orbs.push({ mesh: orb, t: 0, dur: 0.55, maxScale: radius * 1.1 })
  var r2 = radius * radius
  for (let i = enemies.length - 1; i >= 0; i--) {
    var e = enemies[i]
    var dx = e.group.position.x - center.x
    var dy = (e.group.position.y + 0.5) - center.y
    var dz = e.group.position.z - center.z
    if (dx*dx + dy*dy + dz*dz <= r2) damageEnemy(i, dmg)
  }
}

// Side effect: apply damage to the enemy at index i; remove if HP <= 0.
function damageEnemy (i, dmg) {
  var e = enemies[i]
  e.hp -= dmg
  flashEnemyHit(e)
  if (e.hp <= 0) {
    scene.remove(e.group)
    enemies.splice(i, 1)
    state.enemiesKilled++
  }
}

// Side effect: expand impact orb + fade; cull.
function tickOrbs (dt) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    var o = orbs[i]
    o.t += dt
    var k = Math.min(1, o.t / o.dur)
    o.mesh.scale.setScalar(0.1 + (o.maxScale - 0.1) * k)
    o.mesh.material.opacity = 0.7 * (1 - k)
    if (k >= 1) {
      scene.remove(o.mesh)
      orbs.splice(i, 1)
    }
  }
}

// Side effect: expand rally pulse ring + fade.
function tickPulses (dt) {
  for (let i = pulses.length - 1; i >= 0; i--) {
    var p = pulses[i]
    p.t += dt
    var k = Math.min(1, p.t / p.dur)
    var s = 0.2 + 20 * k
    p.mesh.scale.setScalar(s)
    p.mesh.material.opacity = 0.85 * (1 - k)
    if (k >= 1) {
      if (p.inCastle) castle.remove(p.mesh); else scene.remove(p.mesh)
      pulses.splice(i, 1)
    }
  }
}

// Side effect: breath cylinder fade.
function tickBreaths (dt) {
  for (let i = breaths.length - 1; i >= 0; i--) {
    var b = breaths[i]
    b.t += dt
    var k = Math.min(1, b.t / b.dur)
    b.mesh.material.opacity = 0.85 * (1 - k)
    if (k >= 1) {
      scene.remove(b.mesh)
      breaths.splice(i, 1)
    }
  }
}
