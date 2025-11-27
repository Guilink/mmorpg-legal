// --- modules/Monster.js ---
const { MAP_CONFIG, MONSTER_TYPES } = require('./GameConfig');

let monsterIdCounter = 0;

class Monster {
    constructor(type, x, z, mapId) {
        this.id = `mob_${monsterIdCounter++}`;
        this.type = type;
        this.map = mapId;
        this.config = MONSTER_TYPES[type];
        
        // Stats
        this.hp = this.config.hp;
        this.maxHp = this.config.hp;
        
        // Posição
        this.position = { x, y: 0, z };
        this.spawnOrigin = { x, z };
        this.rotation = Math.random() * 6.28;
        
        // Estado
        this.animation = 'IDLE';
        this.targetId = null; 
        this.state = 'IDLE';
        
        // Timers
        this.actionTimer = 0; 
        this.attackCooldown = 0;
        this.isAttackingAnimation = false;
        
        // OTIMIZAÇÃO: Timer específico para não escanear alvos toda hora
        // Inicia com um valor aleatório para que nem todos os monstros calculem no mesmo milissegundo
        this.scanTimer = Math.random() * 1000; 
    }

    update(delta, onlinePlayers, callbacks) {
        if (this.hp <= 0) return;

        const mapData = MAP_CONFIG[this.map];
        const limit = (mapData.mapSize / 2) - 1.5;

        // --- 1. COOLDOWNS E ANIMAÇÃO ---
        if (this.attackCooldown > 0) this.attackCooldown -= delta;
        
        // Se está atacando, trava tudo e sai (Economia de CPU)
        if (this.isAttackingAnimation) {
            this.actionTimer -= delta;
            if (this.actionTimer <= 0) {
                this.isAttackingAnimation = false;
                this.animation = 'IDLE';
            }
            return; 
        }

        // --- 2. GERENCIAMENTO DE ALVO ---
        
        // A) VALIDAÇÃO (Checa se perdeu o alvo atual)
        // Isso precisa ser rápido, roda todo frame se tiver alvo
        if (this.targetId) {
            const target = onlinePlayers[this.targetId];
            let shouldDropTarget = true;

            if (target && target.map === this.map && target.stats.hp > 0) {
                const dx = target.position.x - this.position.x;
                const dz = target.position.z - this.position.z;
                
                // OTIMIZAÇÃO: Verifica primeiro se o alvo fugiu MUITO (Bounding Box simples)
                // Evita conta de raiz quadrada/multiplicação se estiver longe demais
                if (Math.abs(dx) < this.config.sightRange && Math.abs(dz) < this.config.sightRange) {
                     const distSq = (dx * dx) + (dz * dz);
                     const sightSq = this.config.sightRange * this.config.sightRange;
                     if (distSq <= sightSq) shouldDropTarget = false;
                }
            }

            if (shouldDropTarget) {
                this.targetId = null;
                this.state = 'IDLE';
            }
        }

        // B) AQUISIÇÃO (Procura novo alvo)
        // OTIMIZAÇÃO: Só roda se o scanTimer permitir (a cada 1000ms/1s)
        if (!this.targetId && this.config.behavior === 1) {
            this.scanTimer -= delta;
            
            if (this.scanTimer <= 0) {
                this.scanTimer = 1000; // Reseta para procurar daqui a 1 segundo
                
                let closestDistSq = Infinity;
                let bestTargetId = null;
                const sightSq = this.config.sightRange * this.config.sightRange;

                // OTIMIZAÇÃO DE MEMÓRIA: Usando 'for...in' em vez de 'Object.values'
                // Evita criar um Array novo com todos os players a cada loop
                for (let playerId in onlinePlayers) {
                    const player = onlinePlayers[playerId];

                    // Filtros rápidos antes da matemática pesada
                    if (player.map !== this.map || player.stats.hp <= 0) continue;

                    const dx = player.position.x - this.position.x;
                    const dz = player.position.z - this.position.z;

                    // Filtro Bounding Box (quadrado) antes do Círculo (pitágoras)
                    if (Math.abs(dx) > this.config.sightRange || Math.abs(dz) > this.config.sightRange) continue;

                    const distSq = (dx * dx) + (dz * dz);

                    if (distSq <= sightSq && distSq < closestDistSq) {
                        closestDistSq = distSq;
                        bestTargetId = player.id;
                    }
                }

                if (bestTargetId) this.targetId = bestTargetId;
            }
        }

        // --- 3. EXECUÇÃO DE COMPORTAMENTO ---

        if (this.targetId && onlinePlayers[this.targetId]) {
            // MODO COMBATE
            const target = onlinePlayers[this.targetId];
            const dx = target.position.x - this.position.x;
            const dz = target.position.z - this.position.z;
            
            // Só calcula atan2 se realmente for se mover ou virar (otimização leve)
            this.rotation = Math.atan2(dx, dz);
            
            const distSq = (dx * dx) + (dz * dz);
            const attackRangeSq = this.config.range * this.config.range;

            if (distSq <= attackRangeSq) {
                if (this.attackCooldown <= 0) {
                    if(callbacks.onAttack) callbacks.onAttack(this, target);
                }
            } else {
                this.state = 'CHASE';
                this.animation = 'WALK'; // Use RUN se tiver
                const chaseSpeed = this.config.speed * 1.2; 
                this.tryMove(chaseSpeed, this.rotation, limit);
            }

        } else {
            // MODO PATRULHA
            this.actionTimer -= delta;
            
            if (this.actionTimer <= 0) {
                this.state = this.state === 'IDLE' ? 'WALK' : 'IDLE';
                this.animation = this.state;
                // Aumentei o tempo de patrulha para eles ficarem mais "calmos"
                this.actionTimer = 3000 + Math.random() * 4000; 
                
                if(this.state === 'WALK') {
                    this.rotation = Math.random() * 6.28;
                }
            }
            
            if (this.state === 'WALK') {
                this.tryMove(this.config.speed, this.rotation, limit);
            }
        }
    }

    tryMove(speed, angle, limit) {
        const nextX = this.position.x + Math.sin(angle) * speed;
        const nextZ = this.position.z + Math.cos(angle) * speed;
        if (Math.abs(nextX) < limit) this.position.x = nextX;
        if (Math.abs(nextZ) < limit) this.position.z = nextZ;
    }

    startAttack() {
        this.attackCooldown = this.config.attackSpeed;
        this.animation = 'ATTACK';
        this.isAttackingAnimation = true;
        this.actionTimer = 800; // Tempo da animação
    }

    takeDamage(amount, attackerId) {
        this.hp -= amount;
        this.targetId = attackerId; // Reage imediatamente ao ataque
        return this.hp;
    }
}

module.exports = Monster;