// --- FADE MANAGER ---
const fadingMeshes = [];

export const FadeManager = {
    fadeIn: (mesh) => {
        if (!mesh) return;
        mesh.traverse(c => {
            if (c.isMesh && c.material) {
                c.material.transparent = true;
                c.material.opacity = 0;
                c.material.depthWrite = true; 
            }
        });
        mesh.userData.fadeTarget = 1.0;
        mesh.userData.fadeSpeed = 2.0;
        fadingMeshes.push(mesh);
    },

// Adicionei o parâmetro 'sink' (afundar) que padroniza como falso
    fadeOutAndRemove: (mesh, scene, sink = false) => { 
        if (!mesh) return;
        
        // Desativa sombras para não ficar estranho enquanto afunda
        mesh.castShadow = false;
        
        mesh.traverse(c => {
            if (c.isMesh && c.material) {
                c.material.transparent = true;
                c.material.depthWrite = true;
            }
        });

        mesh.userData.fadeTarget = 0.0;
        mesh.userData.fadeSpeed = 2.5;
        mesh.userData.removeOnComplete = true;
        mesh.userData.sceneRef = scene;
        
        // Configuração do efeito de afundar
        mesh.userData.isSinking = sink;
        mesh.userData.sinkSpeed = 0.5; // Velocidade da descida
        
        if (!fadingMeshes.includes(mesh)) fadingMeshes.push(mesh);
    },

    update: (delta) => {
        for (let i = fadingMeshes.length - 1; i >= 0; i--) {
            const mesh = fadingMeshes[i];
            let complete = false;

            // --- LÓGICA DE AFUNDAR (NOVO) ---
            if (mesh.userData.isSinking) {
                // Desce o monstro suavemente pelo eixo Y
                mesh.position.y -= mesh.userData.sinkSpeed * delta;
            }
            // --------------------------------

            mesh.traverse(c => {
                if (c.isMesh && c.material) {
                    const current = c.material.opacity;
                    const target = mesh.userData.fadeTarget;
                    const diff = target - current;
                    
                    if (Math.abs(diff) < 0.05) {
                        c.material.opacity = target;
                        complete = true;
                    } else {
                        c.material.opacity += Math.sign(diff) * mesh.userData.fadeSpeed * delta;
                        c.material.opacity = Math.max(0, Math.min(1, c.material.opacity));
                    }
                }
            });

            if (complete) {
                fadingMeshes.splice(i, 1);
                if (mesh.userData.removeOnComplete) {
                    if(mesh.userData.sceneRef) mesh.userData.sceneRef.remove(mesh);
                } else {
                    mesh.traverse(c => {
                        if (c.isMesh && c.material) c.material.transparent = false;
                    });
                }
            }
        }
    }
};

// --- CHAT BUBBLE ---
export function createChatBubble(mesh, text) {
    if(mesh.userData.activeBubble) { 
        mesh.remove(mesh.userData.activeBubble); 
        mesh.userData.activeBubble = null; 
    }

    const canvas = document.createElement('canvas'); 
    const ctx = canvas.getContext('2d');
    const fontSize = 18; 
    const maxW = 350; 
    const pad = 15;

    ctx.font = `bold ${fontSize}px Arial`;

    const rawWords = text.split(' ');
    const processedWords = [];

    for (let w of rawWords) {
        const width = ctx.measureText(w).width;
        if (width <= maxW) {
            processedWords.push(w);
        } else {
            let temp = "";
            for (let char of w) {
                if (ctx.measureText(temp + char + "-").width < maxW) {
                    temp += char;
                } else {
                    processedWords.push(temp + "-");
                    temp = char;
                }
            }
            if (temp) processedWords.push(temp);
        }
    }

    let lines = [];
    let currentLine = processedWords[0];

    for (let i = 1; i < processedWords.length; i++) {
        const word = processedWords[i];
        const testLine = currentLine + " " + word;
        if (ctx.measureText(testLine).width < maxW) {
            currentLine = testLine;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);

    let realWidth = 0;
    lines.forEach(line => { 
        const metrics = ctx.measureText(line); 
        if (metrics.width > realWidth) realWidth = metrics.width; 
    });

    const w = realWidth + (pad * 2); 
    const h = (lines.length * 24) + (pad * 2);

    canvas.width = w; canvas.height = h;

    ctx.fillStyle = "rgba(0,0,0,0.6)"; 
    ctx.fillRect(0,0,w,h);
    ctx.font = `bold ${fontSize}px Arial`; 
    ctx.fillStyle = "white"; 
    ctx.textAlign = "center"; 
    ctx.textBaseline = "top";

    lines.forEach((l, i) => ctx.fillText(l, w/2, pad + (i*24)));
    
    const texture = new THREE.CanvasTexture(canvas); 
    texture.minFilter = THREE.LinearFilter;
    
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(w * 0.015, h * 0.015, 1); 
    sprite.position.set(0, 3.2, 0); 
    sprite.renderOrder = 999;
    
    mesh.add(sprite); 
    mesh.userData.activeBubble = sprite;
    
    setTimeout(() => { 
        if(mesh.userData.activeBubble===sprite) { 
            mesh.remove(sprite); 
            mesh.userData.activeBubble=null; 
        } 
    }, 6000);
}

// --- DAMAGE NUMBER ---
export function showDamageNumber(dmg, position3D, colorStr, camera) {
    const damageContainer = document.getElementById('damage-container');
    if (!damageContainer || !camera) return;

    const tempV = position3D.clone();
    tempV.y += 2.0; 
    tempV.project(camera);

    const x = (tempV.x * .5 + .5) * window.innerWidth;
    const y = (-(tempV.y * .5) + .5) * window.innerHeight;

    if (tempV.z > 1) return;

    const el = document.createElement('div');
    el.className = 'dmg-number';
    el.textContent = dmg;
    el.style.color = colorStr;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    damageContainer.appendChild(el);

    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 800);
}

// --- TARGET RING ---
export function createTargetIndicator(scene) {
    const geo = new THREE.RingGeometry(0.4, 0.5, 32); 
    const mat = new THREE.MeshBasicMaterial({ 
        color: 0xff0000, transparent: true, opacity: 0.6, side: THREE.DoubleSide 
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2; 
    mesh.position.set(0, 0.05, 0); 
    mesh.visible = false; 
    scene.add(mesh);
    return mesh;
}

// --- TEXT SPRITE ---
export function createTextSprite(text, color) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const ctx = c.getContext('2d'); ctx.font = "bold 32px Arial"; ctx.fillStyle = color; ctx.textAlign = "center";
    ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.strokeText(text, 128, 40); ctx.fillText(text, 128, 40);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
    s.scale.set(2, 0.5, 1); return s;
}

// Cache fora do objeto para persistir
const textureCache = {}; 

export const GroundItemManager = {
    items: {}, 

    spawn: (data, scene, itemDB) => {
        if (GroundItemManager.items[data.uniqueId]) return;

        const dbItem = itemDB[data.itemId];
        if (!dbItem) return;

        const createSprite = (tex) => {
            const material = new THREE.SpriteMaterial({ map: tex, transparent: true });
            const sprite = new THREE.Sprite(material);
            sprite.scale.set(0.6, 0.6, 1); 
            sprite.position.set(data.x, 1.2, data.z); 
            
            sprite.userData = { 
                isGroundItem: true, 
                uniqueId: data.uniqueId, 
                name: dbItem.name,
                state: 'FALLING',
                velocityY: 0
            };
            
            scene.add(sprite);
            GroundItemManager.items[data.uniqueId] = sprite;
        };

        // LÓGICA DE CACHE AQUI
        const iconPath = `assets/icons/${dbItem.icon}`;
        
        if (textureCache[iconPath]) {
            // Se já tem no cache, usa direto (ZERO Custo de Rede)
            createSprite(textureCache[iconPath]);
        } else {
            // Se não tem, carrega e salva
            new THREE.TextureLoader().load(iconPath, (texture) => {
                textureCache[iconPath] = texture;
                createSprite(texture);
            });
        }
    },

    remove: (uniqueId, scene) => {
        const sprite = GroundItemManager.items[uniqueId];
        if (sprite) sprite.userData.state = 'PICKUP';
    },

    expire: (uniqueId, scene) => {
        const sprite = GroundItemManager.items[uniqueId];
        if (sprite) {
            scene.remove(sprite);
            // O material deve ser descartado para liberar memória GPU
            if(sprite.material) sprite.material.dispose();
            delete GroundItemManager.items[uniqueId];
        }
    },    

    clearAll: (scene) => {
        Object.values(GroundItemManager.items).forEach(sprite => {
            scene.remove(sprite);
            if(sprite.material) sprite.material.dispose(); // Importante para memória
        });
        GroundItemManager.items = {};
    },

    update: (delta, scene) => {
        const GRAVITY = 8.0;
        const FLOOR_Y = 0.3;

        Object.keys(GroundItemManager.items).forEach(key => {
            const sprite = GroundItemManager.items[key];
            const state = sprite.userData.state;

            if (state === 'FALLING') {
                sprite.userData.velocityY -= GRAVITY * delta;
                sprite.position.y += sprite.userData.velocityY * delta;

                if (sprite.position.y <= FLOOR_Y) {
                    sprite.position.y = FLOOR_Y;
                    if (Math.abs(sprite.userData.velocityY) > 2.0) {
                        sprite.userData.velocityY = -sprite.userData.velocityY * 0.3;
                    } else {
                        sprite.userData.state = 'IDLE';
                    }
                }
            }
            else if (state === 'PICKUP') {
                sprite.position.y += 2.0 * delta;
                sprite.material.opacity -= 2.0 * delta;

                if (sprite.material.opacity <= 0) {
                    scene.remove(sprite);
                    if(sprite.material) sprite.material.dispose(); // Limpa GPU
                    delete GroundItemManager.items[key];
                }
            }
        });
    }
};

// --- SISTEMA DE PARTÍCULAS (NOVO) ---

// 1. Gera uma textura de partícula "fumacinha" via código (sem precisar de imagem externa)
function createParticleTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32; canvas.height = 32;
    const ctx = canvas.getContext('2d');
    
    // Gradiente radial para parecer uma esfera de luz suave
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)'); // Centro branco
    grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.5)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)'); // Borda transparente
    
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

const particleTexture = createParticleTexture(); // Cache da textura

// Use a textura de partícula que já criamos antes (particleTexture)
// Se não tiver a const particleTexture acessível, certifique-se de que ela está definida no escopo global do módulo VFX.js

// --- PARTICLE MANAGER (Efeitos de Partículas) ---
export const ParticleManager = {
    particles: [],
    emitters: [], 
    meteors: [], 

    // 1. EFEITO DE CURA (Bolhas suaves)
    spawnHealEffect: (scene, position, color) => {
        const material = new THREE.SpriteMaterial({ 
            map: particleTexture, color: color, transparent: true, 
            opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending 
        });

        for (let i = 0; i < 15; i++) {
            const sprite = new THREE.Sprite(material.clone());
            sprite.position.copy(position);
            sprite.position.x += (Math.random() - 0.5) * 0.5;
            sprite.position.y += (Math.random() * 1.0);
            sprite.position.z += (Math.random() - 0.5) * 0.5;
            const scale = 0.2 + Math.random() * 0.3;
            sprite.scale.set(scale, scale, 1);
            sprite.userData = { behavior: 'FLOAT_UP', velocity: new THREE.Vector3((Math.random()-0.5)*0.2, (Math.random()*1.5)+0.5, (Math.random()-0.5)*0.2), life: 1.0+Math.random()*0.5, maxLife: 1.5 };
            scene.add(sprite);
            ParticleManager.particles.push(sprite);
        }
    },

    // 2. EFEITO DE EXPLOSÃO (Genérico)
    spawnExplosion: (scene, position, color, count = 20, sizeScale = 1.0) => {
        const material = new THREE.SpriteMaterial({ 
            map: particleTexture, color: color, transparent: true, 
            opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending 
        });

        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(material.clone());
            sprite.position.copy(position);
            const spread = 0.5 * sizeScale;
            sprite.position.x += (Math.random() - 0.5) * spread;
            sprite.position.y += (Math.random() * 0.5) * sizeScale;
            sprite.position.z += (Math.random() - 0.5) * spread;
            const scale = (0.3 + Math.random() * 0.3) * sizeScale;
            sprite.scale.set(scale, scale, 1);

            sprite.userData = {
                behavior: 'HEAVY_PHYSICS',
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 6.0 * sizeScale,
                    (Math.random() * 3.0) * sizeScale,
                    (Math.random() - 0.5) * 6.0 * sizeScale
                ),
                life: 0.6 + Math.random() * 0.4,
                maxLife: 1.0
            };
            scene.add(sprite);
            ParticleManager.particles.push(sprite);
        }
    },

    // 3. EFEITO DE CHUVA DE METEOROS (3 Pequenos caindo)
    spawnMeteorShower: (scene, centerX, centerZ) => {
        const materialTemplate = new THREE.SpriteMaterial({ 
            map: particleTexture, color: 0xff4400, transparent: true, blending: THREE.AdditiveBlending 
        });

        // Loop para criar 3 meteoros
        for(let i = 0; i < 3; i++) {
            const sprite = new THREE.Sprite(materialTemplate.clone());
            
            // Reduzi o tamanho de 2.5 para 1.5 (são menores agora)
            sprite.scale.set(1.5, 1.5, 1.0);
            
            // Espalhamento aleatório (Raio de 2.5 metros ao redor do clique)
            const offsetX = (Math.random() - 0.5) * 2.5;
            const offsetZ = (Math.random() - 0.5) * 2.5;

            // TRUQUE DA CHUVA: Altura inicial variável!
            // O primeiro cai de 15m, o segundo de 18m, o terceiro de 22m...
            // Isso cria o delay visual natural.
            const startY = 15.0 + (Math.random() * 10.0); 

            sprite.position.set(centerX + offsetX, startY, centerZ + offsetZ);
            
            sprite.userData = { 
                velocityY: -25.0, // Velocidade de queda
                targetY: 0.1,
                explosionScale: 1.0 // Explosão menor (antes era 1.5)
            };

            scene.add(sprite);
            ParticleManager.meteors.push(sprite);
        }
    },

    // 4. PORTAIS
    createPortal: (scene, x, z) => {
        const emitter = { scene: scene, center: new THREE.Vector3(x, 0.05, z), rate: 0.08, timer: 0, color: 0x00ffff };
        ParticleManager.emitters.push(emitter);
    },

    update: (delta, scene) => {
        // --- ATUALIZA METEOROS ---
        for (let i = ParticleManager.meteors.length - 1; i >= 0; i--) {
            const m = ParticleManager.meteors[i];
            m.position.y += m.userData.velocityY * delta;
            
            // Rastro (Trail)
            if (Math.random() < 0.6) {
                const trail = new THREE.Sprite(m.material.clone());
                trail.scale.set(0.6, 0.6, 1.0); // Rastro menor também
                trail.position.copy(m.position);
                trail.position.y += 0.5;
                trail.userData = { behavior: 'HEAVY_PHYSICS', velocity: new THREE.Vector3((Math.random()-0.5), 1, (Math.random()-0.5)), life: 0.2, maxLife: 0.2 };
                scene.add(trail);
                ParticleManager.particles.push(trail);
            }

            // Impacto no Chão
            if (m.position.y <= m.userData.targetY) {
                // Usa o scale definido na criação (agora 1.0 para ser médio)
                ParticleManager.spawnExplosion(scene, m.position, 0xff4400, 25, m.userData.explosionScale);
                
                scene.remove(m); m.material.dispose();
                ParticleManager.meteors.splice(i, 1);
            }
        }

        // --- ATUALIZA EMISSORES ---
        ParticleManager.emitters.forEach(e => {
            e.timer += delta;
            if (e.timer >= e.rate) {
                e.timer = 0;
                const mat = new THREE.SpriteMaterial({ map: particleTexture, color: e.color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
                const sprite = new THREE.Sprite(mat);
                const angle = Math.random() * Math.PI * 2; const radius = 0.7; 
                sprite.position.set(e.center.x + Math.cos(angle) * radius, 0.05, e.center.z + Math.sin(angle) * radius);
                const scale = 0.1 + Math.random() * 0.25; sprite.scale.set(scale, scale, 1);
                sprite.userData = { behavior: 'VORTEX', center: e.center.clone(), angle: angle, radius: radius, speedY: 0.1 + Math.random() * 0.2, angularSpeed: 0.15 + Math.random()*0.3, life: 1.2, maxLife: 1.2 };
                e.scene.add(sprite);
                ParticleManager.particles.push(sprite);
            }
        });

        // --- ATUALIZA PARTÍCULAS GERAIS ---
        for (let i = ParticleManager.particles.length - 1; i >= 0; i--) {
            const p = ParticleManager.particles[i];
            const data = p.userData;

            if (data.behavior === 'VORTEX') {
                data.life -= delta; p.position.y += data.speedY * delta;
                data.angle += data.angularSpeed * delta; data.radius = Math.max(0, data.radius - 0.15 * delta);
                p.position.x = data.center.x + Math.cos(data.angle) * data.radius;
                p.position.z = data.center.z + Math.sin(data.angle) * data.radius;
                const pct = data.life / data.maxLife; p.material.opacity = pct > 0.8 ? (1-pct)*5 : pct*0.8;
            } 
            else if (data.behavior === 'FLOAT_UP') {
                p.position.addScaledVector(data.velocity, delta);
                data.life -= delta;
                p.material.opacity = (data.life / data.maxLife);
            }
            else if (data.behavior === 'HEAVY_PHYSICS') {
                p.position.addScaledVector(data.velocity, delta);
                data.velocity.y -= 6.0 * delta; 
                data.life -= delta;
                p.material.opacity = (data.life / data.maxLife);
            }

            if (data.life <= 0) {
                scene.remove(p); if(p.material) p.material.dispose();
                ParticleManager.particles.splice(i, 1);
            }
        }
    },
    clearAll: (scene) => { 
        ParticleManager.particles.forEach(p => { scene.remove(p); if(p.material) p.material.dispose(); });
        ParticleManager.meteors.forEach(m => { scene.remove(m); if(m.material) m.material.dispose(); });
        ParticleManager.particles = [];
        ParticleManager.meteors = [];
        ParticleManager.emitters = [];
    }
};

// --- PROJECTILE MANAGER (Projéteis com Partículas) ---
let arrowTemplate = null;

export const ProjectileManager = {
    projectiles: [],

    loadAsset: (loader) => {
        loader.load('assets/arrow.glb', (gltf) => {
            const wrapper = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(1.1, 1.1, 1.1); model.rotation.x = -Math.PI / 2;
            wrapper.add(model);
            arrowTemplate = wrapper;
        });
    },

    spawn: (scene, startObj, targetObj, type) => {
        if (!startObj || !targetObj) return;

        const projectileType = type || 'ARROW';
        let projectile;

        if (projectileType === 'FIREBALL') {
            // FIREBALL AGORA É UM SPRITE (Partícula), NÃO UMA ESFERA
            const material = new THREE.SpriteMaterial({ 
                map: particleTexture, 
                color: 0xffaa00, // Amarelo/Laranja
                transparent: true, 
                blending: THREE.AdditiveBlending 
            });
            projectile = new THREE.Sprite(material);
            projectile.scale.set(0.8, 0.8, 1.0);
        } else {
            // FLECHA (Model 3D)
            if (!arrowTemplate) return; 
            projectile = arrowTemplate.clone();
        }

        projectile.position.copy(startObj.position);
        projectile.position.y += 1.2; 

        const initialTargetPos = targetObj.position.clone();
        initialTargetPos.y += 1.0;

        const speed = (projectileType === 'FIREBALL') ? 12.0 : 20.0;

        projectile.userData = {
            type: projectileType, // Guardamos o tipo para saber se gera rastro
            target: targetObj,       
            lastPos: initialTargetPos, 
            speed: speed
        };

        scene.add(projectile);
        ProjectileManager.projectiles.push(projectile);
    },

    update: (delta, scene) => {
        for (let i = ProjectileManager.projectiles.length - 1; i >= 0; i--) {
            const proj = ProjectileManager.projectiles[i];
            const data = proj.userData;

            // --- LÓGICA DE RASTRO (FIREBALL) ---
            if (data.type === 'FIREBALL') {
                // Gera partículas enquanto voa
                if (Math.random() < 0.8) { // 80% de chance por frame (rastro denso)
                    const trailMat = new THREE.SpriteMaterial({ 
                        map: particleTexture, color: 0xff4400, // Rastro mais vermelho
                        transparent: true, blending: THREE.AdditiveBlending 
                    });
                    const trail = new THREE.Sprite(trailMat);
                    trail.position.copy(proj.position);
                    // Leve aleatoriedade
                    trail.position.x += (Math.random()-0.5)*0.2;
                    trail.position.y += (Math.random()-0.5)*0.2;
                    trail.position.z += (Math.random()-0.5)*0.2;
                    
                    const scale = 0.4 + Math.random() * 0.3;
                    trail.scale.set(scale, scale, 1);
                    
                    // Adiciona ao sistema de partículas como 'HEAVY_PHYSICS' ou 'FLOAT_UP' (vamos usar float up mas rapido)
                    trail.userData = { 
                        behavior: 'FLOAT_UP', // Flutua e some
                        velocity: new THREE.Vector3(0, 0, 0), // Fica parado onde nasceu
                        life: 0.3, // Vida curta
                        maxLife: 0.3 
                    };
                    scene.add(trail);
                    ParticleManager.particles.push(trail);
                }
            }
            // -----------------------------------

            let targetPos = null;
            if (data.target && data.target.parent) {
                targetPos = data.target.position.clone();
                targetPos.y += 1.0; 
                data.lastPos.copy(targetPos); 
            } else {
                targetPos = data.lastPos;
            }

            const dist = proj.position.distanceTo(targetPos);

            if (dist < 0.5) {
                // IMPACTO
                if (data.type === 'FIREBALL') {
                    // Explosão visual ao acertar
                    ParticleManager.spawnExplosion(scene, proj.position, 0xffaa00, 10, 0.5);
                }

                scene.remove(proj);
                if (proj.material) proj.material.dispose();
                ProjectileManager.projectiles.splice(i, 1);
                continue;
            }

            const direction = new THREE.Vector3().subVectors(targetPos, proj.position).normalize();
            if (data.type !== 'FIREBALL') proj.lookAt(targetPos); // Flecha aponta, Sprite não precisa
            proj.position.add(direction.multiplyScalar(data.speed * delta));
        }
    }
};

// --- AREA CURSOR (MIRA DE CHÃO) ---
let areaCursorMesh = null;

export const AreaCursor = {
    create: (scene) => {
        const texture = new THREE.TextureLoader().load('assets/magic_circle.png');
        
        const geometry = new THREE.PlaneGeometry(1, 1); 
        
        const material = new THREE.MeshBasicMaterial({ 
            map: texture,
            transparent: true, 
            
            // 1. AJUSTE DE TRANSLUCIDEZ
            opacity: 0.6, // Baixei de 0.8 para 0.6 (Fica mais elegante/suave)
            
            side: THREE.DoubleSide,
            
            // 2. CORREÇÃO DE PROFUNDIDADE (O Segredo)
            depthWrite: false, // Não bloqueia objetos transparentes atrás dele
            depthTest: true,   // <--- MUDANÇA CRÍTICA: Agora ele verifica se tem parede na frente!
            
            // 3. EVITAR "PISCAR" NO CHÃO (Z-Fighting)
            // Como ligamos o depthTest, ele pode brigar com o chão. 
            // Essas duas linhas dizem pra GPU: "Desenha isso um milímetro acima do chão visualmente"
            polygonOffset: true,
            polygonOffsetFactor: -4, 
            polygonOffsetUnits: -4
        });
        
        areaCursorMesh = new THREE.Mesh(geometry, material);
        areaCursorMesh.rotation.x = -Math.PI / 2; 
        
        // Mantemos levemente elevado fisicamente só por segurança
        areaCursorMesh.position.set(0, 0.05, 0);   
        areaCursorMesh.visible = false;
        
        // 4. REMOVEMOS O RENDER ORDER ALTO
        // areaCursorMesh.renderOrder = 999; <--- APAGUE OU COMENTE ESSA LINHA
        // Deixando o padrão (0), ele vai respeitar a ordem natural de profundidade
        
        scene.add(areaCursorMesh);
        return areaCursorMesh;
    },

    updatePosition: (position) => {
        if (areaCursorMesh && position) {
            areaCursorMesh.position.set(position.x, 0.1, position.z);
            // Efeito extra: Gira o círculo devagarzinho para ficar estiloso
            areaCursorMesh.rotation.z += 0.02; 
        }
    },

    setVisible: (visible, radius = 3.0) => {
        if (areaCursorMesh) {
            areaCursorMesh.visible = visible;
            // Ajustamos a escala. Como a geometria é 1x1, multiplicar por (radius * 2) dá o diâmetro correto.
            const size = radius * 2;
            areaCursorMesh.scale.set(size, size, 1);
        }
    },
    
    isActive: () => {
        return areaCursorMesh && areaCursorMesh.visible;
    }
};