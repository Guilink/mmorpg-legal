import { AudioManager } from './AudioManager.js';

export const UI = {
    loginScreen: document.getElementById('login-screen'),
    loadingScreen: document.getElementById('loading-screen'),
    loadingBarFill: document.getElementById('loading-bar-fill'),
    loadingPercent: document.getElementById('loading-percent'),    
    hud: document.getElementById('hud'),
    hudButtons: document.getElementById('hud-buttons'),
    debugPanel: document.getElementById('debug-panel'),
    chatContainer: document.getElementById('chat-container'),
    canvasContainer: document.getElementById('canvas-container'),
    formLogin: document.getElementById('form-login'),
    formRegister: document.getElementById('form-register'),
    inLoginUser: document.getElementById('login-user'),
    inLoginPass: document.getElementById('login-pass'),
    inRegUser: document.getElementById('reg-user'),
    inRegPass: document.getElementById('reg-pass'),
    inRegPass2: document.getElementById('reg-pass2'),
    errorLogin: document.getElementById('login-error'),
    errorReg: document.getElementById('reg-error'),
    lvlText: document.getElementById('lvl-text'),
    xpBar: document.getElementById('xp-bar'),
    hpText: document.getElementById('hp-text'),
    hpBar: document.getElementById('hp-bar'),
    mpText: document.getElementById('mp-text'),
    mpBar: document.getElementById('mp-bar'),
    dbgFps: document.getElementById('dbg-fps'),
    dbgMap: document.getElementById('dbg-map'),
    dbgPos: document.getElementById('dbg-pos'),
    dbgPlayers: document.getElementById('dbg-players'),
    mapName: document.getElementById('map-name'),
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
    inventoryWindow: document.getElementById('inventory-window'),
    eqWeapon: document.getElementById('eq-weapon'),
    eqArmor: document.getElementById('eq-armor'),
    eqHead: document.getElementById('eq-head'),
    eqLegs: document.getElementById('eq-legs'),
    eqAccessory: document.getElementById('eq-accessory'),
    bagGrid: document.getElementById('bag-grid'),
    tooltip: document.getElementById('item-tooltip'),
    skillsWindow: document.getElementById('skills-window'),
    skillsList: document.getElementById('skills-list'), 
    chatInput: document.getElementById('chat-input'),
    chatHistory: document.getElementById('chat-history'),
    hotbarSlots: document.querySelectorAll('.hotkey-slot'),
};

let tempAttributes = {};
let tempPoints = 0;
let realAttributesRef = {};
let equipmentBonuses = { atk: 0, def: 0, matk: 0, eva: 0 };
let attrBonuses = { str: 0, agi: 0, int: 0, vit: 0 };
let currentInventoryRef = [];
let hotbarState = [null, null, null, null, null, null];
let onHotbarChange = null; 

let dragData = {
    index: -1, 
    item: null, 
    type: null, 
    isDragging: false, 
    ghostEl: null, 
    startX: 0, startY: 0
};

// --- FUNÇÕES GERAIS ---
export function toggleForms() {
    const isLogin = UI.formLogin.style.display !== 'none';
    UI.formLogin.style.display = isLogin ? 'none' : 'block';
    UI.formRegister.style.display = isLogin ? 'block' : 'none';
    AudioManager.play2D('ui_click'); 
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
    const hp = stats.hp || 0; const maxHp = stats.maxHp || 100;
    const mp = stats.mp || 0; const maxMp = stats.maxMp || 50;
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
    UI.chatContainer.style.opacity = isActive ? 1 : 0.5;
}

export function updateLoadingBar(percent) {
    if (UI.loadingBarFill) UI.loadingBarFill.style.width = percent + '%';
    if (UI.loadingPercent) UI.loadingPercent.textContent = Math.floor(percent) + '%';
}

// --- STATUS ---
export function setupStatusWindowData(currentAttributes, currentPoints, currentRealStats, onlyUpdateBonuses = false) {
    if (!onlyUpdateBonuses) {
        tempAttributes = { ...currentAttributes };
        tempPoints = currentPoints;
    }
    realAttributesRef = { ...currentAttributes };
    const totalAttrs = currentRealStats.totalAttributes || currentAttributes;
    
    attrBonuses.str = totalAttrs.str - currentAttributes.str;
    attrBonuses.agi = totalAttrs.agi - currentAttributes.agi;
    attrBonuses.int = totalAttrs.int - currentAttributes.int;
    attrBonuses.vit = totalAttrs.vit - currentAttributes.vit;

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
    UI.statusWindow.style.display = (UI.statusWindow.style.display === 'none') ? 'block' : 'none';
    if(UI.statusWindow.style.display === 'block') refreshStatusWindow();
    AudioManager.play2D('ui_click'); 
}

export function refreshStatusWindow() {
    UI.valStr.textContent = tempAttributes.str;
    UI.valAgi.textContent = tempAttributes.agi;
    UI.valInt.textContent = tempAttributes.int;
    UI.valVit.textContent = tempAttributes.vit;
    
    const setBonusText = (id, val) => {
        const el = document.getElementById(id);
        if(el) el.textContent = val > 0 ? ` +${val}` : '';
    };

    setBonusText('bon-str', attrBonuses.str);
    setBonusText('bon-agi', attrBonuses.agi);
    setBonusText('bon-int', attrBonuses.int);
    setBonusText('bon-vit', attrBonuses.vit);

    UI.stPoints.textContent = tempPoints;

    const newBaseAtk = 10 + (tempAttributes.str * 2);
    const newBaseDef = Math.floor(tempAttributes.vit * 1);
    const newBaseMatk = Math.floor(tempAttributes.int * 2);
    const newBaseEva = Math.floor((tempAttributes.str * 0.1) + (tempAttributes.agi * 0.5));
    const aspd = Math.max(500, 2000 - (tempAttributes.agi * 20));

    UI.dAtk.textContent = newBaseAtk;
    UI.dDef.textContent = newBaseDef;
    UI.dMatk.textContent = newBaseMatk;
    UI.dEva.textContent = newBaseEva;
    UI.dSpd.textContent = aspd + 'ms';

    setBonusText('bon-atk', equipmentBonuses.atk);
    setBonusText('bon-def', equipmentBonuses.def);
    setBonusText('bon-matk', equipmentBonuses.matk);
    setBonusText('bon-eva', equipmentBonuses.eva);
}

export function changeAttr(type, amount) {
    if (amount > 0) {
        if (tempPoints > 0) { tempAttributes[type]++; tempPoints--; AudioManager.play2D('ui_stat'); } 
    } else {
        if (tempAttributes[type] > realAttributesRef[type]) { tempAttributes[type]--; tempPoints++; AudioManager.play2D('ui_stat'); }
    }
    refreshStatusWindow();
}

export function getTempAttributes() { return tempAttributes; }

export function toggleInventory() {
    const el = UI.inventoryWindow;
    const tooltip = document.getElementById('item-tooltip');
    if (el.style.display === 'none') {
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
    }
    AudioManager.play2D('ui_click'); 
}

export function toggleSkills() {
    const el = UI.skillsWindow;
    el.style.display = (el.style.display === 'none') ? 'block' : 'none';
    AudioManager.play2D('ui_click'); 
}

// -------------------------------------------------------------
// FUNÇÃO ATUALIZADA: LÓGICA DE CLIQUE DIREITO E DUPLO CLIQUE
// -------------------------------------------------------------
UI.updateInventory = function(inventory, equipment, itemDB, skillDB) {
    currentInventoryRef = inventory;
    hideTooltip();
    
    // 1. Equipamentos (Corpo)
    const renderEquip = (slotName, el) => {
        const id = equipment[slotName];
        el.innerHTML = '';
        if (id && itemDB[id]) {
            const item = itemDB[id];
            el.innerHTML = `<img src="assets/icons/${item.icon}">`;
            el.onmouseenter = (e) => showTooltip(e, item);
            el.onmouseleave = hideTooltip;
            
            // REMOVIDO: Clique Esquerdo (onclick)
            el.onclick = null;

            // ADICIONADO: Clique Direito (oncontextmenu) para desequipar
            el.oncontextmenu = (e) => {
                e.preventDefault(); // Impede o menu do navegador
                if(window.unequipItem) window.unequipItem(slotName);
                // O som 'equip' já é chamado no game.js dentro de unequipItem
            };
        } else { 
            el.onmouseenter = null; el.onmouseleave = null; el.onclick = null; el.oncontextmenu = null;
        }
    };
    renderEquip('weapon', UI.eqWeapon);
    renderEquip('armor', UI.eqArmor);
    renderEquip('head', UI.eqHead);
    renderEquip('legs', UI.eqLegs);
    renderEquip('accessory', UI.eqAccessory);

    // 2. Mochila (Itens)
    UI.bagGrid.innerHTML = '';
    inventory.forEach((slot, index) => {
        const div = document.createElement('div');
        div.className = 'item-slot';
        if (slot && itemDB[slot.id]) {
            const item = itemDB[slot.id];
            div.innerHTML = `<img src="assets/icons/${item.icon}">`;
            if (slot.qtd > 1) div.innerHTML += `<div class="item-qtd">${slot.qtd}</div>`;
            
            div.onmouseenter = (e) => { if(!dragData.isDragging) showTooltip(e, item); };
            div.onmouseleave = hideTooltip;
            
            div.onmousedown = (e) => {
                if(e.button !== 0) return;
                e.preventDefault();
                dragData.index = index; 
                dragData.item = { ...item, qtd: slot.qtd }; 
                dragData.type = 'ITEM'; 
                dragData.startX = e.clientX; dragData.startY = e.clientY;
                dragData.isDragging = false;
                document.addEventListener('mousemove', onDragMove);
            };

            // Duplo Clique (Equipar/Usar)
            div.ondblclick = () => {
                if(window.useItem) window.useItem(index);
                // Toca som se for equipamento
                if(item.type === 'equipment') {
                    AudioManager.play2D('equip');
                }
            };
        }
        UI.bagGrid.appendChild(div);
    });

    // 3. Skills (Lista)
    if (skillDB && UI.skillsList) {
        UI.skillsList.innerHTML = '';
        Object.values(skillDB).forEach(skill => {
            const div = document.createElement('div');
            div.className = 'skill-item';

            div.onmouseenter = (e) => { if(!dragData.isDragging) showTooltip(e, skill, 'SKILL'); };
            div.onmouseleave = hideTooltip;            
            
            const iconSrc = skill.icon || 'default.png';
            div.innerHTML = `
                <div class="skill-icon" style="cursor: grab;">
                    <img src="assets/icons/${iconSrc}" style="width:32px; height:32px; pointer-events: none;">
                </div>
                <div class="skill-info">
                    <div class="skill-name">${skill.name}</div>
                    <div class="skill-desc">MP: ${skill.manaCost} | CD: ${skill.cooldown/1000}s</div>
                </div>
            `;
            
            const iconDiv = div.querySelector('.skill-icon');
            iconDiv.onmousedown = (e) => {
                if(e.button !== 0) return;
                e.preventDefault();
                dragData.index = -1; 
                dragData.item = skill; 
                dragData.type = 'SKILL'; 
                dragData.startX = e.clientX; dragData.startY = e.clientY;
                dragData.isDragging = false;
                document.addEventListener('mousemove', onDragMove);
            };

            UI.skillsList.appendChild(div);
        });
    }
};

function hideTooltip() { UI.tooltip.style.display = 'none'; }
let pendingDropIndex = -1;
function openDropModal(index, item) {
    pendingDropIndex = index;
    const modal = document.getElementById('drop-modal');
    const nameEl = document.getElementById('drop-item-name');
    const qtdCont = document.getElementById('drop-qtd-container');
    const input = document.getElementById('drop-qtd-input');
    modal.style.display = 'flex';
    nameEl.textContent = item.name;
    if (item.qtd > 1) { qtdCont.style.display = 'block'; input.max = item.qtd; input.value = 1; setTimeout(() => input.focus(), 50); } 
    else { qtdCont.style.display = 'none'; input.value = 1; }
    AudioManager.play2D('ui_click');
}
window.closeDropModal = () => { document.getElementById('drop-modal').style.display = 'none'; };
window.confirmDrop = () => {
    const input = document.getElementById('drop-qtd-input');
    let qtd = parseInt(input.value);
    if(qtd < 1) qtd = 1;
    if(window.requestDrop) window.requestDrop(pendingDropIndex, qtd);
    closeDropModal();
};
function makeDraggable(elementId) {
    const el = document.getElementById(elementId);
    if(!el) return;
    const header = el.querySelector('.win-header');
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;
    header.onmousedown = function(e) {
        e.preventDefault();
        el.style.zIndex = parseInt(window.getComputedStyle(el).zIndex) + 2;
        isDragging = true;
        startX = e.clientX; startY = e.clientY;
        const rect = el.getBoundingClientRect();
        if (el.style.transform !== 'none') { el.style.left = rect.left + 'px'; el.style.top = rect.top + 'px'; el.style.transform = 'none'; el.style.margin = 0; }
        initialLeft = el.offsetLeft; initialTop = el.offsetTop;
        document.onmousemove = onMouseMove; document.onmouseup = onMouseUp;
    };
    function onMouseMove(e) { if (!isDragging) return; const dx = e.clientX - startX; const dy = e.clientY - startY; el.style.left = (initialLeft + dx) + 'px'; el.style.top = (initialTop + dy) + 'px'; }
    function onMouseUp() { isDragging = false; document.onmousemove = null; document.onmouseup = null; }
}

export function startCooldownUI(id, duration, type = 'SKILL') {
    const slots = document.querySelectorAll('.hotkey-slot');
    for (let i = 0; i < 6; i++) {
        const data = hotbarState[i];
        if (data && data.type === type && data.id === id) {
            const overlay = slots[i].querySelector('.cd-overlay');
            if (overlay) {
                overlay.style.transition = 'none';
                overlay.style.height = '100%';
                void overlay.offsetWidth; 
                overlay.style.transition = `height ${duration}ms linear`;
                overlay.style.height = '0%';
            }
        }
    }
}

export function setHotbarChangeCallback(fn) {
    onHotbarChange = fn;
}

export function loadHotbarState(savedState) {
    if (savedState && Array.isArray(savedState)) {
        hotbarState = savedState;
        renderHotbarStateOnly(currentInventoryRef);
    }
}

// ----------------------------------------------------------------------
// GESTÃO GLOBAL DE CLIQUES (Drag & Drop) - CORREÇÃO CRÍTICA AQUI
// ----------------------------------------------------------------------
document.addEventListener('mouseup', (e) => {
    // 1. Limpar Hotbar com botão direito
    if (e.button === 2) {
        const slot = e.target.closest('.hotkey-slot');
        if (slot) {
            const key = parseInt(slot.dataset.key) - 1;
            hotbarState[key] = null; 
            renderHotbarStateOnly(currentInventoryRef); 
            if(onHotbarChange) onHotbarChange(hotbarState); 
            AudioManager.play2D('ui_click'); 
        }
        return;
    }

    // 2. Soltou Drag (Botão Esquerdo)
    if (dragData.isDragging) {
        stopItemDrag(); 
        
        // A. Colocar na Hotbar
        const hotbarSlot = e.target.closest('.hotkey-slot');
        if (hotbarSlot) {
            const key = parseInt(hotbarSlot.dataset.key) - 1;
            if (dragData.type === 'ITEM') hotbarState[key] = { type: 'ITEM', id: dragData.item.id };
            else if (dragData.type === 'SKILL') hotbarState[key] = { type: 'SKILL', id: dragData.item.id };
            renderHotbarStateOnly(currentInventoryRef); 
            if(onHotbarChange) onHotbarChange(hotbarState);
            AudioManager.play2D('ui_click'); 
        }

        // B. (NOVO) Arrastar para Equipar
        // CORREÇÃO BUG 2: Verifica se soltou em um slot de equipamento
        else if (dragData.type === 'ITEM') {
            const equipSlot = e.target.closest('.equip-doll .item-slot');
            
            if (equipSlot) {
                // O ID do slot é algo como 'eq-weapon', 'eq-head'. Removemos o prefixo.
                const targetSlotName = equipSlot.id.replace('eq-', '');
                
                // Verifica se o item arrastado é do tipo EQUIPAMENTO e se vai no slot certo
                // Nota: dragData.item possui as props do ITEM_DATABASE (slot, type, etc)
                if (dragData.item.type === 'equipment' && dragData.item.slot === targetSlotName) {
                    
                    // Executa a ação de equipar (que no servidor é 'use_item')
                    if(window.useItem) window.useItem(dragData.index);
                    AudioManager.play2D('equip');
                
                } else {
                    // Feedback visual ou sonoro de erro (opcional)
                    addLogMessage('SISTEMA', 'Slot incorreto para este item.', 'system');
                }
            }
            
            // C. Jogar no chão (Drop) - Mantém a lógica original
            else {
                const rect = UI.inventoryWindow.getBoundingClientRect();
                const isInside = (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
                if (!isInside && UI.inventoryWindow.style.display !== 'none') openDropModal(dragData.index, dragData.item);
            }
        }
    } else {
        // 3. Clique Simples sem arrastar
        
        // --- AQUI ESTAVA O PROBLEMA DO CLIQUE ÚNICO ---
        // Removi a parte que chamava window.useItem(dragData.index) aqui.
        // Agora, usar itens depende exclusivamente do ondblclick definido no updateInventory.

        // Clique na Hotbar (usar atalho)
        const hotbarSlot = e.target.closest('.hotkey-slot');
        if (hotbarSlot) {
            const key = parseInt(hotbarSlot.dataset.key) - 1;
            if (window.triggerHotkey) window.triggerHotkey(key);
        }
    }

    // Limpeza
    document.removeEventListener('mousemove', onDragMove);
    dragData.index = -1; dragData.item = null; dragData.isDragging = false; dragData.type = null;
});

function onDragMove(e) {
    if (dragData.item === null) return;
    if (!dragData.isDragging) {
        const dx = Math.abs(e.clientX - dragData.startX);
        const dy = Math.abs(e.clientY - dragData.startY);
        if (dx > 5 || dy > 5) startItemDrag(e);
    }
    if (dragData.isDragging && dragData.ghostEl) {
        dragData.ghostEl.style.left = (e.clientX - 20) + 'px';
        dragData.ghostEl.style.top = (e.clientY - 20) + 'px';
    }
}

function startItemDrag(e) {
    dragData.isDragging = true;
    hideTooltip();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    const iconSrc = dragData.item.icon || 'default.png';
    ghost.innerHTML = `<img src="assets/icons/${iconSrc}">`;
    document.body.appendChild(ghost);
    dragData.ghostEl = ghost;
    ghost.style.left = (e.clientX - 20) + 'px';
    ghost.style.top = (e.clientY - 20) + 'px';
}

function stopItemDrag() {
    if (dragData.ghostEl) { dragData.ghostEl.remove(); dragData.ghostEl = null; }
}

let globalItemDB = {};
let globalSkillDB = {};

export function renderHotbar(inventory, itemDB, skillDB) {
    if (itemDB) globalItemDB = itemDB;
    if (skillDB) globalSkillDB = skillDB;
    renderHotbarStateOnly(inventory);
}

function renderHotbarStateOnly(inventory) {
    const slots = document.querySelectorAll('.hotkey-slot');
    hotbarState.forEach((slotData, index) => {
        const slotDiv = slots[index];
        let overlay = slotDiv.querySelector('.cd-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'cd-overlay';
            slotDiv.appendChild(overlay);
        }
        const contentDiv = slotDiv.querySelector('.hotkey-content');
        const qtdDiv = slotDiv.querySelector('.hotkey-qtd');   
        contentDiv.innerHTML = ''; qtdDiv.textContent = ''; slotDiv.style.opacity = '1';
        if (slotData) {
            if (slotData.type === 'ITEM') {
                const item = globalItemDB[slotData.id];
                if (item) {
                    contentDiv.innerHTML = `<img src="assets/icons/${item.icon}">`;
                    if (inventory) {
                        const itemInBag = inventory.find(i => i.id === slotData.id);
                        if (itemInBag && itemInBag.qtd >= 1) qtdDiv.textContent = itemInBag.qtd;
                        else slotDiv.style.opacity = '0.5';
                    }
                }
            } else if (slotData.type === 'SKILL') {
                const skill = globalSkillDB[slotData.id];
                if (skill) contentDiv.innerHTML = `<img src="assets/icons/${skill.icon}">`;
            }
        }
    });
}

export function getHotkeyItem(slotIndex) { return hotbarState[slotIndex]; }

function showTooltip(e, data, type = 'ITEM') {
    const tt = UI.tooltip;
    let htmlContent = '';
    if (type === 'ITEM') {
        const item = data;
        let statsHtml = '';
        if(item.stats) {
            if(item.stats.atk) statsHtml += `<span class="stat">ATQ: +${item.stats.atk}</span>`;
            if(item.stats.matk) statsHtml += `<span class="stat">M.ATQ: +${item.stats.matk}</span>`;
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
        if (item.range) statsHtml += `<span class="stat" style="color:#aaa">Alcance: ${item.range}m</span>`;
        const titleColor = item.type === 'equipment' ? '#ffd700' : '#fff';
        htmlContent = `<h3 style="color:${titleColor}">${item.name}</h3><div class="desc">${item.description}</div><hr style="border-color:#444; margin:5px 0;">${statsHtml}`;
    } else if (type === 'SKILL') {
        const skill = data;
        let detailsHtml = '';
        let titleColor = '#fff';
        if (skill.type === 'MELEE') titleColor = '#ffff00';
        else if (skill.type === 'CASTING' || skill.type === 'INSTANT') titleColor = '#00ffff'; 
        else if (skill.type === 'SUPPORT') titleColor = '#00ff00';
        else if (skill.type === 'AREA') titleColor = '#ff0000';    
        if (skill.damage) detailsHtml += `<span class="stat" style="color:#ff8888">Poder: ${skill.damage}</span>`;
        if (skill.effect && skill.effect.hp) detailsHtml += `<span class="stat" style="color:#ff8888">Poder de Cura: ${skill.effect.hp}</span>`;
        if (skill.range) detailsHtml += `<span class="stat" style="color:#88ff88">Alcance: ${skill.range}m</span>`;
        if (skill.radius) detailsHtml += `<span class="stat" style="color:#88ff88">Área: ${skill.radius}m</span>`;
        if (skill.castTime > 0) detailsHtml += `<span class="stat" style="color:#ffa500">Conjuração: ${(skill.castTime/1000).toFixed(1)}s</span>`;
        else detailsHtml += `<span class="stat" style="color:#ffa500">Instantâneo</span>`;
        detailsHtml += `<span class="stat" style="color:#ffff00; font-weight:bold;">Custo de Mana: ${skill.manaCost}</span>`;
        htmlContent = `<h3 style="color:${titleColor}">${skill.name}</h3><div class="desc" style="color:#ccc; font-style:italic;">${skill.description || ''}</div><hr style="border-color:#444; margin:5px 0;">${detailsHtml}`;
    }
    tt.innerHTML = htmlContent;
    tt.style.display = 'block';
    const width = tt.offsetWidth; const height = tt.offsetHeight;
    let finalX = e.clientX + 15; let finalY = e.clientY + 15;
    if (finalX + width > window.innerWidth) finalX = e.clientX - width - 10;
    if (finalY + height > window.innerHeight) finalY = e.clientY - height - 10;
    tt.style.left = finalX + 'px'; tt.style.top = finalY + 'px';
}

makeDraggable('status-window');
makeDraggable('inventory-window');
makeDraggable('skills-window');