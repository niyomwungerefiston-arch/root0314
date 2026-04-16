/**
 * Buchat — Multi-device connection registry
 *
 * Remplace la Map<userId, socket> par Map<userId, Set<socket>>.
 * Un utilisateur peut avoir plusieurs sockets actifs (iPhone + PC
 * + tablette) ; chaque événement "à destination d'un user" doit
 * être diffusé à TOUS ses sockets.
 *
 * Usage :
 *   const users = createRegistry();
 *   users.add(socket);
 *   users.emitToUser(userId, 'new_message', payload);
 *   users.remove(socket);
 */

function createRegistry() {
  const byUser = new Map(); // userId -> Set<socket>

  function add(socket) {
    const uid = socket.user && socket.user.id;
    if (!uid) return;
    if (!byUser.has(uid)) byUser.set(uid, new Set());
    byUser.get(uid).add(socket);
  }

  function remove(socket) {
    const uid = socket.user && socket.user.id;
    if (!uid) return;
    const set = byUser.get(uid);
    if (!set) return;
    set.delete(socket);
    if (set.size === 0) byUser.delete(uid);
  }

  /**
   * Émet un événement à tous les sockets d'un utilisateur.
   * @param {string} userId
   * @param {string} event
   * @param {any}    payload
   * @param {string} excludeSocketId  — pour ne pas renvoyer à l'émetteur
   * @returns {boolean} true si au moins un socket a reçu
   */
  function emitToUser(userId, event, payload, excludeSocketId = null) {
    const set = byUser.get(userId);
    if (!set || set.size === 0) return false;
    let sent = false;
    for (const s of set) {
      if (excludeSocketId && s.id === excludeSocketId) continue;
      s.emit(event, payload);
      sent = true;
    }
    return sent;
  }

  function isOnline(userId) {
    const set = byUser.get(userId);
    return !!(set && set.size > 0);
  }

  function hasConnection(userId) {
    return isOnline(userId);
  }

  function countDevices(userId) {
    const set = byUser.get(userId);
    return set ? set.size : 0;
  }

  function listOnline() {
    return [...byUser.keys()];
  }

  function forEach(cb) {
    for (const [uid, set] of byUser) cb(uid, set);
  }

  return {
    add,
    remove,
    emitToUser,
    isOnline,
    hasConnection,
    countDevices,
    listOnline,
    forEach,
    _raw: byUser,
  };
}

module.exports = { createRegistry };
