// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

export function setChatActive(state) {
    isChatActive = state;
}

export function getIsChatActive() {
    return isChatActive;
}

// MUDANÇA 1: Adicionei onToggleSkills no final dos argumentos
export function setupInputs(onEnterPress, onSit, onAttack, onToggleStatus, onToggleInventory, onPickup, onHotkey, onTab, onToggleSkills) { 
    
    document.addEventListener('contextmenu', event => event.preventDefault());

    document.addEventListener('keydown', e => {
        if (e.repeat) return; 

        if (isChatActive) {
            if (e.key === 'Enter') if(onEnterPress) onEnterPress();
            return;
        }

        // Atalhos Numéricos
        if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
            if (onHotkey) onHotkey(parseInt(e.key));
            return;
        } 

        // Atalhos de Ação
        if (e.key.toLowerCase() === 'q') if(onPickup) onPickup();
        if (e.key === 'Tab') { e.preventDefault(); if(onTab) onTab(); return; }
        if (e.key.toLowerCase() === 'f') if(onAttack) onAttack();
        if (e.code === 'Space') if(onSit) onSit();
        if(e.key === 'Enter') { if(onEnterPress) onEnterPress(); return; }

        // Atalhos de UI
        if (e.altKey && e.key.toLowerCase() === 'a') { e.preventDefault(); if (onToggleStatus) onToggleStatus(); return; }
        if (e.altKey && e.key.toLowerCase() === 'e') { e.preventDefault(); if (onToggleInventory) onToggleInventory(); return; }

        // MUDANÇA 2: Tecla S para Skills (Só se não estiver no chat)
        if (e.altKey && e.key.toLowerCase() === 'h') {e.preventDefault(); if (onToggleSkills) onToggleSkills(); return; }
        
        keys[e.key.toLowerCase()] = true;
    });

    document.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('blur', () => {
        for (let k in keys) keys[k] = false;
    });
}