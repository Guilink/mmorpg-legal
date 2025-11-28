// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

export function setChatActive(state) {
    isChatActive = state;
}

export function getIsChatActive() {
    return isChatActive;
}

// AGORA ACEITA 6 FUNÇÕES (A última é o onPickup)
export function setupInputs(onEnterPress, onSit, onAttack, onToggleStatus, onToggleInventory, onPickup, onHotkey) { 
    
    // --- BLOQUEIO GERAL DO BOTÃO DIREITO (CONTEXT MENU) ---
    document.addEventListener('contextmenu', event => event.preventDefault());

    document.addEventListener('keydown', e => {
        if (e.repeat) return; 

        // Se estiver no chat, ignora números (para poder digitar números no chat)
        if (isChatActive) {
            if (e.key === 'Enter') if(onEnterPress) onEnterPress();
            return;
        }

        // --- ATALHOS DA HOTBAR (1 a 6) ---
        // Verifica se a tecla é um número entre 1 e 6
        if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
            if (onHotkey) onHotkey(parseInt(e.key));
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

        // --- ATALHO DE PEGAR ITEM (NOVO) ---
        if (e.key.toLowerCase() === 'q') {
            if(onPickup) onPickup();
            // Não damos return aqui para permitir andar e pegar ao mesmo tempo se quiser
        }
        // -----------------------------------

        if (isChatActive) {
            if (e.key === 'Enter') if(onEnterPress) onEnterPress();
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