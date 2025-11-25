// public/js/InputManager.js

export const keys = {};
let isChatActive = false;

// CORREÇÃO: Removemos 'socket' e 'myPlayer' daqui. 
// Agora a função aceita exatamente os 3 callbacks que o game.js envia.
export function setupInputs(onChatToggle, onAttack, onSit) {

    document.addEventListener('keydown', e => {
        // Lógica do Chat (Enter)
        if(e.key === 'Enter') {
            isChatActive = !isChatActive;
            if(onChatToggle) onChatToggle(isChatActive);
        }
        
        // Comandos de Jogo (Só funcionam se o chat estiver fechado)
        if(!isChatActive) {
            keys[e.key.toLowerCase()] = true;

            // Space para Sentar
            if(e.code === 'Space') {
                if(onSit) onSit(); 
            }
            
            // F para Atacar
            if(e.key.toLowerCase() === 'f') {
                if(onAttack) onAttack();
            }
        }
    });

    document.addEventListener('keyup', e => {
        // Solta a tecla (importante para parar de andar)
        keys[e.key.toLowerCase()] = false;
    });
}

export function getIsChatActive() {
    return isChatActive;
}