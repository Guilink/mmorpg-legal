// --- modules/Monster.js ---
const { MAP_CONFIG, MONSTER_TYPES } = require('./GameConfig');

let monsterIdCounter = 0;

class Monster {
    constructor(type, x, z, mapId) {
        this.id = `mob_${monsterIdCounter++}`;
        this.type = type;
        this.map = mapId;
        this.config = MONSTER_TYPES[type];
        this.hp = this.config.hp;
        this.maxHp = this.config.hp;
        this.position = { x, y: 0, z };
        this.spawnOrigin = { x, z };
        this.rotation = Math.random() * 6.28;
        this.animation = 'IDLE';
        this.targetId = null; 
        this.state = 'IDLE';
        this.actionTimer = 0; 
        this.attackCooldown = 0;
        this.isAttackingAnimation = false;
    }

    // Recebemos 'onlinePlayers' e funções de callback para notificar o servidor
    update(delta, onlinePlayers, callbacks) {
        if (this.hp <= 0) return;

        const mapData = MAP_CONFIG[this.map];
        const limit = (mapData.mapSize / 2) - 1.5;

        // Cooldowns
        if (this.attackCooldown > 0) this.attackCooldown -= delta;
        if (this.isAttackingAnimation) {
            this.actionTimer -= delta;
            if (this.actionTimer <= 0) {
                this.isAttackingAnimation = false;
                this.animation = 'IDLE';
            }
            return;
        }

        let speed = this.config.speed;
        if (this.state === 'CHASE') speed *= 1.8;

        // Lógica de IA
        if (this.targetId && onlinePlayers[this.targetId] && onlinePlayers[this.targetId].map === this.map) {
            const target = onlinePlayers[this.targetId];
            const dx = target.position.x - this.position.x;
            const dz = target.position.z - this.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz);
            this.rotation = Math.atan2(dx, dz);

            if (dist <= this.config.range) {
                if (this.attackCooldown <= 0) {
                    // Chama a função de ataque definida no server.js
                    if(callbacks.onAttack) callbacks.onAttack(this, target);
                }
            } else {
                this.state = 'CHASE';
                this.animation = 'WALK';
                this.tryMove(speed, this.rotation, limit);
            }
        } else {
            this.targetId = null;
            this.actionTimer -= delta;
            
            if (this.actionTimer <= 0) {
                this.state = this.state === 'IDLE' ? 'WALK' : 'IDLE';
                this.animation = this.state;
                this.actionTimer = 2000 + Math.random() * 3000;
                if(this.state === 'WALK') this.rotation = Math.random() * 6.28;
            }
            
            if (this.state === 'WALK') {
                this.tryMove(speed, this.rotation, limit);
            }
        }
    }

    tryMove(speed, angle, limit) {
        const nextX = this.position.x + Math.sin(angle) * speed;
        const nextZ = this.position.z + Math.cos(angle) * speed;
        if (Math.abs(nextX) < limit) this.position.x = nextX;
        if (Math.abs(nextZ) < limit) this.position.z = nextZ;
    }

    // Configura animação de ataque e cooldown
    startAttack() {
        this.attackCooldown = this.config.attackSpeed;
        this.animation = 'ATTACK';
        this.isAttackingAnimation = true;
        this.actionTimer = 800;
    }

    takeDamage(amount, attackerId) {
        this.hp -= amount;
        this.targetId = attackerId;
        return this.hp;
    }
}

module.exports = Monster;