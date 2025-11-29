// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

// Esta função precisa ter o 'export' na frente para o game.js encontrá-la
export function setChatActive(state) {
    isChatActive = state;
}

// Esta também precisa do 'export' (é aqui que seu erro está ocorrendo)
export function getIsChatActive() {
    return isChatActive;
}

export function setupInputs(onEnterPress, onSit, onAttack, onToggleStatus, onToggleInventory, onPickup, onHotkey, onTab, onToggleSkills) { 
    
    document.addEventListener('contextmenu', event => event.preventDefault());

    document.addEventListener('keydown', e => {
        // Bloqueia atalhos de navegador que atrapalham jogos
        if (e.key === 'Alt' || e.key === 'F10' || (e.ctrlKey && e.key === 's')) {
            e.preventDefault();
        }        
        if (e.repeat) return; 

        if (isChatActive) {
            if (e.key === 'Enter') if(onEnterPress) onEnterPress();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            
            // Se o chat estiver focado, tira o foco
            if (document.activeElement === document.getElementById('chat-input')) {
                document.getElementById('chat-input').blur();
                return;
            }

            // Hierarquia de Fechamento de Janelas
            const ui = document.getElementById('status-window');
            const inv = document.getElementById('inventory-window');
            const skills = document.getElementById('skills-window');
            const dropModal = document.getElementById('drop-modal');

            // 1. Modal de Drop
            if (dropModal && dropModal.style.display !== 'none') {
                if(window.closeDropModal) window.closeDropModal();
                return;
            }

            // 2. Janela de Skills
            if (skills && skills.style.display !== 'none') {
                if(onToggleSkills) onToggleSkills();
                return;
            }

            // 3. Inventário
            if (inv && inv.style.display !== 'none') {
                if(onToggleInventory) onToggleInventory();
                return;
            }

            // 4. Status
            if (ui && ui.style.display !== 'none') {
                if(onToggleStatus) onToggleStatus();
                return;
            }

            return;
        }
        
        // Atalhos Numéricos (Hotbar)
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
        if (e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); if (onToggleSkills) onToggleSkills(); return; }
        
        keys[e.key.toLowerCase()] = true;
    });

    document.addEventListener('keyup', e => {
        keys[e.key.toLowerCase()] = false;
    });

    window.addEventListener('blur', () => {
        for (let k in keys) keys[k] = false;
    });
}