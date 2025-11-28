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

    fadeOutAndRemove: (mesh, scene) => { // Nota: Recebe a scene agora para remover
        if (!mesh) return;
        mesh.castShadow = false;
        mesh.traverse(c => {
            if (c.isMesh && c.material) {
                c.material.transparent = true;
                c.material.depthWrite = true;
            }
        });
        mesh.userData.fadeTarget = 0.0;
        mesh.userData.fadeSpeed = 2.0;
        mesh.userData.removeOnComplete = true;
        mesh.userData.sceneRef = scene; // Guarda referencia da cena
        
        if (!fadingMeshes.includes(mesh)) fadingMeshes.push(mesh);
    },

    update: (delta) => {
        for (let i = fadingMeshes.length - 1; i >= 0; i--) {
            const mesh = fadingMeshes[i];
            let complete = false;

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
            sprite.scale.set(0.4, 0.4, 1); 
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
        const FLOOR_Y = 0.1;

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

// ... (Mantenha a função createParticleTexture e a const particleTexture no topo igual) ...

export const ParticleManager = {
    particles: [],
    emitters: [], 

    // Explosão (Poções - Mantido igual)
    spawnBurst: (scene, position, color, count = 20) => {
        const material = new THREE.SpriteMaterial({ 
            map: particleTexture, color: color, transparent: true, 
            opacity: 1.0, depthWrite: false, blending: THREE.AdditiveBlending 
        });

        for (let i = 0; i < count; i++) {
            const sprite = new THREE.Sprite(material.clone());
            sprite.position.copy(position);
            sprite.position.x += (Math.random() - 0.5) * 0.5;
            sprite.position.y += (Math.random() * 1.0) + 0.5;
            sprite.position.z += (Math.random() - 0.5) * 0.5;
            
            const scale = 0.3 + Math.random() * 0.3;
            sprite.scale.set(scale, scale, 1);

            sprite.userData = {
                behavior: 'PHYSICS',
                velocity: new THREE.Vector3(
                    (Math.random() - 0.5) * 0.5,
                    (Math.random() * 1.0) + 0.5,
                    (Math.random() - 0.5) * 0.5
                ),
                life: 1.0 + Math.random() * 0.5,
                maxLife: 1.5
            };
            scene.add(sprite);
            ParticleManager.particles.push(sprite);
        }
    },

    // --- PORTAL DE CHÃO (VÓRTICE SUAVE) ---
    createPortal: (scene, x, z) => {
        const emitter = {
            scene: scene,
            center: new THREE.Vector3(x, 0.05, z), // Bem rente ao chão
            rate: 0.08, // Levemente menos partículas para não poluir
            timer: 0,
            color: 0x00ffff // Ciano
        };
        ParticleManager.emitters.push(emitter);
    },

    update: (delta, scene) => {
        // 1. Atualiza Emissores
        ParticleManager.emitters.forEach(e => {
            e.timer += delta;
            if (e.timer >= e.rate) {
                e.timer = 0;
                
                const material = new THREE.SpriteMaterial({ 
                    map: particleTexture, 
                    color: e.color, 
                    transparent: true, 
                    opacity: 0.0, 
                    depthWrite: false, 
                    blending: THREE.AdditiveBlending 
                });

                const sprite = new THREE.Sprite(material);
                
                // AJUSTE 1: Raio inicial um pouco menor (0.9)
                const angle = Math.random() * Math.PI * 2;
                const radius = 0.7; 

                sprite.position.set(
                    e.center.x + Math.cos(angle) * radius,
                    0.05, // Nasce no chão
                    e.center.z + Math.sin(angle) * radius
                );

                // Tamanho das partículas um pouco menor
                const scale = 0.10 + Math.random() * 0.25;
                sprite.scale.set(scale, scale, 1);

                sprite.userData = {
                    behavior: 'VORTEX',
                    center: e.center.clone(),
                    angle: angle,
                    radius: radius,
                    
                    // --- AQUI ESTÃO AS MUDANÇAS CHAVE ---
                    // Velocidade de subida MUITO BAIXA (0.1 a 0.3) -> Fica no chão
                    speedY: 0.1 + Math.random() * 0.2, 
                    
                    // Rotação mais calma (1.0 a 1.5) -> Antes era 2.0+
                    angularSpeed: 0.15 + Math.random() * 0.3, 
                    
                    // Vida curta (1.2s) -> Morre antes de subir muito
                    life: 1.2, 
                    maxLife: 1.2
                };

                e.scene.add(sprite);
                ParticleManager.particles.push(sprite);
            }
        });

        // 2. Atualiza Partículas
        for (let i = ParticleManager.particles.length - 1; i >= 0; i--) {
            const p = ParticleManager.particles[i];
            const data = p.userData;

            if (data.behavior === 'VORTEX') {
                data.life -= delta;
                
                // Sobe devagar
                p.position.y += data.speedY * delta;
                
                // Gira suavemente
                data.angle += data.angularSpeed * delta;
                
                // Fecha o raio BEM DEVAGAR (para manter o formato de disco/pizza)
                data.radius -= 0.15 * delta; // Antes era 0.3
                if (data.radius < 0) data.radius = 0;

                p.position.x = data.center.x + Math.cos(data.angle) * data.radius;
                p.position.z = data.center.z + Math.sin(data.angle) * data.radius;

                // Opacidade: Fade in rápido, Fade out lento
                const lifePct = data.life / data.maxLife;
                if (lifePct > 0.8) {
                    p.material.opacity = (1.0 - lifePct) * 5.0; 
                } else {
                    p.material.opacity = lifePct * 0.8; // Max opacidade 0.8 (mais sutil)
                }

            } else {
                // Física normal (Poções)
                p.position.addScaledVector(data.velocity, delta);
                data.velocity.y += 0.5 * delta;
                data.life -= delta;
                p.material.opacity = (data.life / data.maxLife);
            }

            if (data.life <= 0) {
                scene.remove(p);
                p.material.dispose();
                ParticleManager.particles.splice(i, 1);
            }
        }
    },
    
    clearAll: (scene) => {
        ParticleManager.particles.forEach(p => {
             scene.remove(p);
             p.material.dispose();
        });
        ParticleManager.particles = [];
        ParticleManager.emitters = [];
    }
};

let arrowTemplate = null;

export const ProjectileManager = {
    projectiles: [],

    loadAsset: (loader) => {
        loader.load('assets/arrow.glb', (gltf) => {
            const wrapper = new THREE.Group();
            const model = gltf.scene;
            model.scale.set(1.1, 1.1, 1.1); 
            model.rotation.x = -Math.PI / 2; // Ajuste para a flecha ficar reta
            wrapper.add(model);
            arrowTemplate = wrapper;
            console.log("Assets de flecha carregados.");
        });
    },

    spawn: (scene, startObj, targetObj, type) => {
        // Se não tiver template (ainda carregando) ou objetos inválidos, sai
        if (!startObj || !targetObj) return;

        const projectileType = type || 'ARROW'; // Fallback para flecha
        let projectile;

        if (projectileType === 'FIREBALL') {
            // Cria esfera laranja para bola de fogo
            const geo = new THREE.SphereGeometry(0.3, 8, 8);
            const mat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
            projectile = new THREE.Mesh(geo, mat);
        } else {
            // Flecha Padrão
            if (!arrowTemplate) return; 
            projectile = arrowTemplate.clone();
        }

        // Posição inicial
        projectile.position.copy(startObj.position);
        projectile.position.y += 1.2; 

        // Salva posição inicial do alvo para caso ele morra
        const initialTargetPos = targetObj.position.clone();
        initialTargetPos.y += 1.0;

        // Velocidade diferente por tipo
        const speed = (projectileType === 'FIREBALL') ? 12.0 : 20.0;

        projectile.userData = {
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
            let targetPos = null;

            // Se o alvo existe na cena
            if (data.target && data.target.parent) {
                targetPos = data.target.position.clone();
                targetPos.y += 1.0; 
                data.lastPos.copy(targetPos); 
            } else {
                // Alvo morreu, usa última posição
                targetPos = data.lastPos;
            }

            const dist = proj.position.distanceTo(targetPos);

            if (dist < 0.5) {
                scene.remove(proj);
                // Limpeza de memória se for geometria criada na hora
                if (proj.geometry) proj.geometry.dispose(); 
                if (proj.material) proj.material.dispose();
                
                ProjectileManager.projectiles.splice(i, 1);
                continue;
            }

            const direction = new THREE.Vector3().subVectors(targetPos, proj.position).normalize();
            
            // LookAt funciona bem para flecha, mas para esfera é indiferente (mas não atrapalha)
            proj.lookAt(targetPos);
            proj.position.add(direction.multiplyScalar(data.speed * delta));
        }
    }
};

// --- AREA CURSOR (MIRA DE CHÃO) ---
let areaCursorMesh = null;

export const AreaCursor = {
    create: (scene) => {
        // Cria um anel para indicar a área
        const geometry = new THREE.RingGeometry(0.1, 1.0, 32); 
        const material = new THREE.MeshBasicMaterial({ 
            color: 0x00aaff, // Azul
            transparent: true, 
            opacity: 0.5, 
            side: THREE.DoubleSide,
            depthTest: false, // Desenha sempre por cima do chão
            depthWrite: false
        });
        
        areaCursorMesh = new THREE.Mesh(geometry, material);
        areaCursorMesh.rotation.x = -Math.PI / 2; // Deitado
        areaCursorMesh.position.set(0, 0.1, 0);   // Pouco acima do chão
        areaCursorMesh.visible = false;
        
        // RenderOrder alto para aparecer sobre o terreno
        areaCursorMesh.renderOrder = 999; 
        
        scene.add(areaCursorMesh);
        return areaCursorMesh;
    },

    updatePosition: (position) => {
        if (areaCursorMesh && position) {
            areaCursorMesh.position.set(position.x, 0.1, position.z);
        }
    },

    setVisible: (visible, radius = 3.0) => {
        if (areaCursorMesh) {
            areaCursorMesh.visible = visible;
            // O RingGeometry base tem raio externo 1.0. 
            // Para ter raio X, escalamos por X.
            areaCursorMesh.scale.set(radius, radius, 1);
        }
    },
    
    isActive: () => {
        return areaCursorMesh && areaCursorMesh.visible;
    }
};