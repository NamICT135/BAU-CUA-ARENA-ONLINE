import { Repository } from '../db/Repository.js';
import { query } from '../db/connection.js';
import { TransactionManager } from '../db/TransactionManager.js';

export class RoomRepository extends Repository {
  constructor() {
    super('rooms');
  }

  async findByCode(code) {
    const res = await query(`SELECT * FROM rooms WHERE code = $1 AND status != 'closed'`, [code]);
    return res.rows[0] || null;
  }

  async createRoom({ code, name, hostId, capacity = 20, bettingDuration = 30 }) {
    return TransactionManager.withinTransaction(async client => {
      const res = await client.query(
        `INSERT INTO rooms (code, name, host_id, capacity, betting_duration, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [code, name, hostId, capacity, bettingDuration]
      );
      const room = res.rows[0];
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role) VALUES ($1, $2, 'host')`,
        [room.id, hostId]
      );
      return room;
    });
  }

  async addMember(roomId, userId, role = 'player') {
    try {
      const res = await query(
        `INSERT INTO room_members (room_id, user_id, role)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [roomId, userId, role]
      );
      return res.rows[0];
    } catch (err) {
      // idx_unique_active_membership: user đã có active membership ở phòng khác
      if (err.code === '23505') {
        return null;
      }
      throw err;
    }
  }

  async removeMember(roomId, userId) {
    const res = await query(
      `UPDATE room_members
       SET left_at = CURRENT_TIMESTAMP
       WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL
       RETURNING *`,
      [roomId, userId]
    );
    return res.rows[0] || null;
  }

  async getRoomMembers(roomId) {
    const res = await query(
      `SELECT m.*, u.username, u.display_name, u.avatar_key
       FROM room_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.room_id = $1 AND m.left_at IS NULL`,
      [roomId]
    );
    return res.rows;
  }

  async closeRoom(roomId) {
    return TransactionManager.withinTransaction(async client => {
      await client.query(
        `UPDATE room_members SET left_at = CURRENT_TIMESTAMP
         WHERE room_id = $1 AND left_at IS NULL`,
        [roomId]
      );
      const res = await client.query(
        `UPDATE rooms SET status = 'closed', closed_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING *`,
        [roomId]
      );
      return res.rows[0] || null;
    });
  }
}
