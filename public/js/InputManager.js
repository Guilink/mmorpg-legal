// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

// Esta função permite que o game.js force o estado do chat
export function setChatActive(state) {
    isChatActive = state;
}

// O erro no console dizia que esta função não existia/não estava exportada
export function getIsChatActive() {
    return isChatActive;
}

// A função principal com as novas regras de ataque
export function setupInputs(onEnterPress, onSit, onAttack, onToggleStatus, onToggleInventory) { 
    document.addEventListener('keydown', e => {
        if (e.repeat) return; 

        // --- ATALHOS DE UI (Funcionam mesmo com chat aberto ou andando) ---
        // Alt + S: Status
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault(); // Impede menu do navegador
            if (onToggleStatus) onToggleStatus();
            return;
        }

        // Alt + I: Inventário
        if (e.altKey && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            if (onToggleInventory) onToggleInventory();
            return;
        }
        // ----------------------------------------------------------------

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