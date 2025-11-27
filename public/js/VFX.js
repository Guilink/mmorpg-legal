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