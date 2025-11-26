// public/js/UIManager.js

// --- 1. REFERÊNCIAS AO DOM (CACHE) ---
export const UI = {
    loginScreen: document.getElementById('login-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingBarFill: document.getElementById('loading-bar-fill'),
    loadingPercent: document.getElementById('loading-percent'),    
    hud: document.getElementById('hud'),
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

    // Chat
    chatInput: document.getElementById('chat-input'),
    chatHistory: document.getElementById('chat-history')
};

// --- 2. VARIÁVEIS LOCAIS PARA A JANELA DE STATUS ---
let tempAttributes = {};
let tempPoints = 0;
let realAttributesRef = {}; // Guarda referência dos atributos reais para comparar

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

export function updateDebug(mapId, pos, playersCount) {
    if(UI.dbgMap) UI.dbgMap.textContent = mapId.toUpperCase();
    if(UI.dbgPos) UI.dbgPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
    if(UI.dbgPlayers) UI.dbgPlayers.textContent = playersCount;
}

export function addLogMessage(user, msg, type) {
    if(!UI.chatHistory) return;
    UI.chatHistory.innerHTML += `<div class="chat-msg"><span style="color:${type==='system'?'#ff0':'#0ff'}">[${user}]:</span> ${msg}</div>`;
    UI.chatHistory.scrollTop = UI.chatHistory.scrollHeight;
}

export function toggleChatFocus(isActive) {
    if(isActive) {
        UI.chatInput.focus(); 
        UI.chatContainer.style.opacity = 1;
    } else {
        UI.chatInput.blur(); 
        UI.chatContainer.style.opacity = 0.5;
    }
}

// --- 4. LÓGICA DA JANELA DE STATUS (AQUI ESTAVAM FALTANDO AS EXPORTS) ---

// Chamado pelo game.js quando vai abrir a janela
export function setupStatusWindowData(currentAttributes, currentPoints) {
    // Clona os objetos para não mexer no oficial até salvar
    tempAttributes = { ...currentAttributes };
    realAttributesRef = { ...currentAttributes }; // Cópia de segurança para saber o mínimo
    tempPoints = currentPoints;
}

export function toggleStatusWindow() {
    if (UI.statusWindow.style.display === 'none') {
        UI.statusWindow.style.display = 'block';
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

    // Recalculo visual (Apenas previsão)
    UI.dAtk.textContent = 10 + (tempAttributes.str * 2);
    UI.dDef.textContent = Math.floor(tempAttributes.vit * 1);
    UI.dMatk.textContent = Math.floor(tempAttributes.int * 2);
    UI.dEva.textContent = Math.floor((tempAttributes.str * 0.1) + (tempAttributes.agi * 0.5));
    const aspd = Math.max(500, 2000 - (tempAttributes.agi * 20));
    UI.dSpd.textContent = aspd + 'ms';
}

// Essa é a função que o erro dizia estar faltando!
export function changeAttr(type, amount) {
    if (amount > 0) {
        // Adicionar ponto
        if (tempPoints > 0) { 
            tempAttributes[type]++; 
            tempPoints--; 
        }
    } else {
        // Remover ponto (não pode ficar menor do que o que o player já tinha salvo)
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
    if (UI.loadingBarFill) {
        UI.loadingBarFill.style.width = percent + '%';
    }
    if (UI.loadingPercent) {
        UI.loadingPercent.textContent = Math.floor(percent) + '%';
    }
}