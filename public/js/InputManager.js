// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

export function setChatActive(state) {
    isChatActive = state;
}

export function getIsChatActive() {
    return isChatActive;
}

// ADICIONADO: onTab no final dos argumentos
export function setupInputs(onEnterPress, onSit, onAttack, onToggleStatus, onToggleInventory, onPickup, onHotkey, onTab) { 
    
    document.addEventListener('contextmenu', event => event.preventDefault());

    document.addEventListener('keydown', e => {
        if (e.repeat) return; 

        if (isChatActive) {
            if (e.key === 'Enter') if(onEnterPress) onEnterPress();
            return;
        }

        // --- ATALHOS DA HOTBAR (1 a 6) ---
        if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
            if (onHotkey) onHotkey(parseInt(e.key));
            return;
        } 

        // --- ATALHO DE PEGAR ITEM (Q) ---
        if (e.key.toLowerCase() === 'q') {
            if(onPickup) onPickup();
        }

        // --- NOVO: ATALHO DE TAB (TARGET) ---
        if (e.key === 'Tab') {
            e.preventDefault(); // Impede sair do foco da janela
            if(onTab) onTab();
            return;
        }

        // --- ATALHOS DE UI ---
        if (e.altKey && e.key.toLowerCase() === 'a') {
            e.preventDefault();
            if (onToggleStatus) onToggleStatus();
            return;
        }

        if (e.altKey && e.key.toLowerCase() === 'e') {
            e.preventDefault();
            if (onToggleInventory) onToggleInventory();
            return;
        }

        if(e.key === 'Enter') {
            if(onEnterPress) onEnterPress();
            return; 
        }
        
        keys[e.key.toLowerCase()] = true;

        if(e.code === 'Space') {
            if(onSit) onSit(); 
        }

        if(e.key.toLowerCase() === 'f') {
            if(onAttack) onAttack();
        }
    });

    document.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('blur', () => {
        for (let k in keys) keys[k] = false;
    });
}