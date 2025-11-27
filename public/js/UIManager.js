// public/js/UIManager.js

// --- 1. REFERÊNCIAS AO DOM (CACHE) ---
export const UI = {
    // Telas
    loginScreen: document.getElementById('login-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingBarFill: document.getElementById('loading-bar-fill'),
    loadingPercent: document.getElementById('loading-percent'),    
    hud: document.getElementById('hud'),
    hudButtons: document.getElementById('hud-buttons'), // Novo
    debugPanel: document.getElementById('debug-panel'),
    chatContainer: document.getElementById('chat-container'),
    canvasContainer: document.getElementById('canvas-container'),
    
    // Auth Forms
    formLogin: document.getElementById('form-login'),
    formRegister: document.getElementById('form-register'),
    inLoginUser: document.getElementById('login-user'),
    inLoginPass: document.getElementById('login-pass'),
    inRegUser: document.getElementById('reg-user'),
    inRegPass: document.getElementById('reg-pass'),
    inRegPass2: document.getElementById('reg-pass2'),
    errorLogin: document.getElementById('login-error'),
    errorReg: document.getElementById('reg-error'),

    // HUD Stats
    lvlText: document.getElementById('lvl-text'),
    xpBar: document.getElementById('xp-bar'),
    hpText: document.getElementById('hp-text'),
    hpBar: document.getElementById('hp-bar'),
    mpText: document.getElementById('mp-text'),
    mpBar: document.getElementById('mp-bar'),

    // Debug
    dbgFps: document.getElementById('dbg-fps'),
    dbgMap: document.getElementById('dbg-map'),
    dbgPos: document.getElementById('dbg-pos'),
    dbgPlayers: document.getElementById('dbg-players'),
    mapName: document.getElementById('map-name'),

    // Janela Status
    statusWindow: document.getElementById('status-window'),
    valStr: document.getElementById('val-str'),
    valAgi: document.getElementById('val-agi'),
    valInt: document.getElementById('val-int'),
    valVit: document.getElementById('val-vit'),
    stPoints: document.getElementById('st-points'),
    dAtk: document.getElementById('d-atk'),
    dDef: document.getElementById('d-def'),
    dMatk: document.getElementById('d-matk'),
    dEva: document.getElementById('d-eva'),
    dSpd: document.getElementById('d-spd'),

    // Janela Inventário
    inventoryWindow: document.getElementById('inventory-window'),
    eqWeapon: document.getElementById('eq-weapon'),
    eqArmor: document.getElementById('eq-armor'),
    eqHead: document.getElementById('eq-head'),
    eqLegs: document.getElementById('eq-legs'),
    eqAccessory: document.getElementById('eq-accessory'),
    bagGrid: document.getElementById('bag-grid'),
    tooltip: document.getElementById('item-tooltip'),

    // Chat
    chatInput: document.getElementById('chat-input'),
    chatHistory: document.getElementById('chat-history')
};

// --- 2. VARIÁVEIS LOCAIS PARA A JANELA DE STATUS ---
let tempAttributes = {};
let tempPoints = 0;
let realAttributesRef = {};
let equipmentBonuses = { atk: 0, def: 0, matk: 0, eva: 0 };

// --- 3. FUNÇÕES GERAIS DE UI ---

export function toggleForms() {
    const isLogin = UI.formLogin.style.display !== 'none';
    UI.formLogin.style.display = isLogin ? 'none' : 'block';
    UI.formRegister.style.display = isLogin ? 'block' : 'none';
}

export function showAuthError(msg, type) {
    const el = type === 'login' ? UI.errorLogin : UI.errorReg;
    el.textContent = msg;
    setTimeout(() => el.textContent = '', 3000);
}

export function showGameInterface() {
    UI.loginScreen.style.display = 'none';
    UI.hud.style.display = 'block';
    if(UI.hudButtons) UI.hudButtons.style.display = 'flex';
    UI.debugPanel.style.display = 'block';
    UI.chatContainer.style.display = 'block';
}

export function updateHUD(stats, level, xp, nextXp) {
    const hp = stats.hp || 0;
    const maxHp = stats.maxHp || 100;
    const mp = stats.mp || 0;
    const maxMp = stats.maxMp || 50;

    if(UI.lvlText) UI.lvlText.textContent = level;
    
    const xpPercent = nextXp > 0 ? (xp / nextXp) * 100 : 0;
    if(UI.xpBar) UI.xpBar.style.width = Math.min(100, Math.max(0, xpPercent)) + '%';

    if(UI.hpText) UI.hpText.textContent = `${Math.ceil(hp)}/${maxHp}`;
    if(UI.hpBar) UI.hpBar.style.width = ((hp / maxHp) * 100) + '%';

    if(UI.mpText) UI.mpText.textContent = `${mp}/${maxMp}`;
    if(UI.mpBar) UI.mpBar.style.width = ((mp / maxMp) * 100) + '%';
}

export function updateDebug(mapId, pos, localCount, totalCount) {
    if(UI.dbgMap) UI.dbgMap.textContent = mapId.toUpperCase();
    if(UI.dbgPos) UI.dbgPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
    if(UI.dbgPlayers) UI.dbgPlayers.textContent = `${totalCount || '?'} (${localCount})`; 
}

export function addLogMessage(user, msg, type) {
    if(!UI.chatHistory) return;
    UI.chatHistory.innerHTML += `<div class="chat-msg"><span style="color:${type==='system'?'#ff0':'#0ff'}">[${user}]:</span> ${msg}</div>`;
    UI.chatHistory.scrollTop = UI.chatHistory.scrollHeight;
}

export function toggleChatFocus(isActive) {
    if(isActive) {
        UI.chatContainer.style.opacity = 1; 
    } else {
        UI.chatContainer.style.opacity = 0.5;
    }
}

// --- 4. LÓGICA DA JANELA DE STATUS ---

export function setupStatusWindowData(currentAttributes, currentPoints, currentRealStats) {
    tempAttributes = { ...currentAttributes };
    realAttributesRef = { ...currentAttributes };
    tempPoints = currentPoints;

    // Cálculo Reverso de Bônus de Equipamento
    const baseAtk = 10 + (currentAttributes.str * 2);
    const baseDef = Math.floor(currentAttributes.vit * 1);
    const baseMatk = Math.floor(currentAttributes.int * 2);
    const baseEva = Math.floor((currentAttributes.str * 0.1) + (currentAttributes.agi * 0.5));

    equipmentBonuses.atk = (currentRealStats.atk || baseAtk) - baseAtk;
    equipmentBonuses.def = (currentRealStats.def || baseDef) - baseDef;
    equipmentBonuses.matk = (currentRealStats.matk || baseMatk) - baseMatk;
    equipmentBonuses.eva = (currentRealStats.eva || baseEva) - baseEva;
}

export function toggleStatusWindow() {
    if (UI.statusWindow.style.display === 'none') {
        UI.statusWindow.style.display = 'block';
        // Se a janela de inventário estiver aberta, pode-se querer fechar ou manter por cima
        refreshStatusWindow();
    } else {
        UI.statusWindow.style.display = 'none';
    }
}

export function refreshStatusWindow() {
    UI.valStr.textContent = tempAttributes.str;
    UI.valAgi.textContent = tempAttributes.agi;
    UI.valInt.textContent = tempAttributes.int;
    UI.valVit.textContent = tempAttributes.vit;
    UI.stPoints.textContent = tempPoints;

    // Base + Bônus
    const newBaseAtk = 10 + (tempAttributes.str * 2);
    UI.dAtk.textContent = newBaseAtk + equipmentBonuses.atk;

    const newBaseDef = Math.floor(tempAttributes.vit * 1);
    UI.dDef.textContent = newBaseDef + equipmentBonuses.def;

    const newBaseMatk = Math.floor(tempAttributes.int * 2);
    UI.dMatk.textContent = newBaseMatk + equipmentBonuses.matk;

    const newBaseEva = Math.floor((tempAttributes.str * 0.1) + (tempAttributes.agi * 0.5));
    UI.dEva.textContent = newBaseEva + equipmentBonuses.eva;

    const aspd = Math.max(500, 2000 - (tempAttributes.agi * 20));
    UI.dSpd.textContent = aspd + 'ms';
}

export function changeAttr(type, amount) {
    if (amount > 0) {
        if (tempPoints > 0) { 
            tempAttributes[type]++; 
            tempPoints--; 
        }
    } else {
        if (tempAttributes[type] > realAttributesRef[type]) { 
            tempAttributes[type]--; 
            tempPoints++; 
        }
    }
    refreshStatusWindow();
}

export function getTempAttributes() {
    return tempAttributes;
}

export function updateLoadingBar(percent) {
    if (UI.loadingBarFill) UI.loadingBarFill.style.width = percent + '%';
    if (UI.loadingPercent) UI.loadingPercent.textContent = Math.floor(percent) + '%';
}

// --- 5. LÓGICA DE INVENTÁRIO ---

UI.updateInventory = function(inventory, equipment, db) {
    hideTooltip();
    // A. Renderiza Equipamentos
    const renderEquip = (slotName, el) => {
        const id = equipment[slotName];
        el.innerHTML = '';
        if (id && db[id]) {
            const item = db[id];
            el.innerHTML = `<img src="assets/icons/${item.icon}">`;
            el.onmouseenter = (e) => showTooltip(e, item);
            el.onmouseleave = hideTooltip;
        } else {
            // Limpa eventos
            el.onmouseenter = null;
            el.onmouseleave = null;
        }
    };

    renderEquip('weapon', UI.eqWeapon);
    renderEquip('armor', UI.eqArmor);
    renderEquip('head', UI.eqHead);
    renderEquip('legs', UI.eqLegs);
    renderEquip('accessory', UI.eqAccessory);

    // B. Renderiza Mochila
    UI.bagGrid.innerHTML = '';
    inventory.forEach((slot, index) => {
        const div = document.createElement('div');
        div.className = 'item-slot';
        
        if (slot && db[slot.id]) {
            const item = db[slot.id];
            div.innerHTML = `<img src="assets/icons/${item.icon}">`;
            if (slot.qtd > 1) {
                div.innerHTML += `<div class="item-qtd">${slot.qtd}</div>`;
            }
            
            div.onclick = () => window.useItem(index);
            div.onmouseenter = (e) => showTooltip(e, item);
            div.onmouseleave = hideTooltip;
        }

        UI.bagGrid.appendChild(div);
    });
};

// Funções Internas de Tooltip
function showTooltip(e, item) {
    const tt = UI.tooltip;
    
    let statsHtml = '';
    if(item.stats) {
        if(item.stats.atk) statsHtml += `<span class="stat">ATK: +${item.stats.atk}</span>`;
        if(item.stats.def) statsHtml += `<span class="stat">DEF: +${item.stats.def}</span>`;
        if(item.stats.str) statsHtml += `<span class="stat">FOR: +${item.stats.str}</span>`;
        if(item.stats.agi) statsHtml += `<span class="stat">AGI: +${item.stats.agi}</span>`;
        if(item.stats.int) statsHtml += `<span class="stat">INT: +${item.stats.int}</span>`;
        if(item.stats.vit) statsHtml += `<span class="stat">VIT: +${item.stats.vit}</span>`;
        if(item.stats.hp)  statsHtml += `<span class="stat">MaxHP: +${item.stats.hp}</span>`;
    }
    if(item.effect) {
         if(item.effect.hp) statsHtml += `<span class="stat" style="color:#f55">Recupera: ${item.effect.hp} HP</span>`;
         if(item.effect.mp) statsHtml += `<span class="stat" style="color:#55f">Recupera: ${item.effect.mp} MP</span>`;
    }

    tt.innerHTML = `
        <h3 style="color:${item.type === 'equipment' ? '#ffd700' : '#fff'}">${item.name}</h3>
        <div class="desc">${item.description}</div>
        <hr style="border-color:#444; margin:5px 0;">
        ${statsHtml}
    `;

    tt.style.display = 'block';

    // Cálculo de posição para não sair da tela
    const width = tt.offsetWidth;
    const height = tt.offsetHeight;

    let finalX = e.clientX + 15;
    let finalY = e.clientY + 15;

    if (finalX + width > window.innerWidth) {
        finalX = e.clientX - width - 10;
    }
    if (finalY + height > window.innerHeight) {
        finalY = e.clientY - height - 10;
    }

    tt.style.left = finalX + 'px';
    tt.style.top = finalY + 'px';
}

function hideTooltip() {
    UI.tooltip.style.display = 'none';
}