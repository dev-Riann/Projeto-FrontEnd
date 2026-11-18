import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let usuarioLogado = null;
let saveTimer = null;

const esc = (t = '') => String(t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// cores neon antigas -> versão suave do novo visual
const MAPA_CORES = {'#d573b6':'#b9a8f5','#58a6ff':'#6cc5c0','#6ed0bc':'#7ccf9b','#8b5cf6':'#b9a8f5'};
const PRIO_TEXTO = {high:'Alta prioridade', medium:'Média prioridade', low:'Baixa prioridade'};

function setStatus(texto, tipo = '') {
    const el = document.getElementById('save-status');
    if (el) { el.textContent = texto; el.dataset.tipo = tipo; }
}
const chaveLocal = () => `tasky-v2-${usuarioLogado.uid}`;

function lerLocal() {
    try {
        const novo = JSON.parse(localStorage.getItem(chaveLocal()));
        if (novo && novo.columns) return novo;
        // dados antigos (versão da faculdade): não perde nada
        const antigo = JSON.parse(localStorage.getItem(`dashboard-data-${usuarioLogado.email}`));
        if (Array.isArray(antigo)) return { t: 0, columns: antigo };
    } catch (e) { console.warn('Leitura local falhou', e); }
    return null;
}

function enviarNuvem(dados) {
    setDoc(doc(db, 'boards', usuarioLogado.uid), { t: dados.t, payload: JSON.stringify(dados.columns) })
        .then(() => setStatus('Salvo na nuvem', 'ok'))
        .catch(e => { console.warn('Nuvem indisponível', e); setStatus('Salvo só neste navegador', 'aviso'); });
}

function agendarSalvar(columns) {
    const dados = { t: Date.now(), columns };
    try { localStorage.setItem(chaveLocal(), JSON.stringify(dados)); } catch (e) {}
    setStatus('Salvando…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => enviarNuvem(dados), 500);
}

async function iniciar(user) {
    usuarioLogado = {
        uid: user.uid,
        name: user.displayName || user.email.split('@')[0],
        email: user.email,
        picture: user.photoURL || 'imagens/porco.jpg'
    };
    const set = (id, fn) => { const el = document.getElementById(id); if (el) fn(el); };
    set('user-avatar', el => el.src = usuarioLogado.picture);
    set('dropdown-avatar', el => el.src = usuarioLogado.picture);
    set('user-name', el => el.textContent = usuarioLogado.name);
    set('user-email', el => el.textContent = usuarioLogado.email);

    const local = lerLocal();
    let nuvem = null, nuvemOk = true;
    try {
        const snap = await getDoc(doc(db, 'boards', user.uid));
        if (snap.exists()) nuvem = snap.data();
    } catch (e) { nuvemOk = false; console.warn('Nuvem indisponível', e); }

    let dados = local;
    if (nuvem && (!local || nuvem.t >= local.t)) dados = { t: nuvem.t, columns: JSON.parse(nuvem.payload) };
    carregarBoard(dados ? dados.columns : null);
    document.body.classList.remove('carregando');

    if (nuvemOk && dados && (!nuvem || dados.t > nuvem.t)) enviarNuvem({ t: dados.t || Date.now(), columns: dados.columns });
    else setStatus(nuvemOk ? 'Salvo na nuvem' : 'Salvo só neste navegador', nuvemOk ? 'ok' : 'aviso');
}

//FUNÇÕES DE SALVAMENTO E CARREGAMENTO


//FUNÇÃO: SALVAR BOARD COMPLETO NO LOCALSTORAGE ESPECÍFICO POR USUÁRIO
function salvarBoard() {
    if (!usuarioLogado) return;

    const colunas = [...document.querySelectorAll('.dashboard-column')].map(coluna => {
        const id = coluna.dataset.id;
        const cor = coluna.style.getPropertyValue('--column-color').trim() || '#8b5cf6';
        const titulo = coluna.querySelector('.dashboard-title h2').textContent;
        const cards = [...coluna.querySelectorAll('.dashboard-card')].map(card => {
            const badge = card.querySelector('.badge');
            return {
                id: card.dataset.cardId || Date.now().toString(),
                priority: badge ? badge.dataset.priority : 'low',
                priorityText: badge ? badge.querySelector('span').textContent : 'Baixa prioridade',
                title: card.querySelector('.title-card').textContent,
            };
        });
        
        return { id, cor, titulo, cards };
    });

    agendarSalvar(colunas);
}

//FUNÇÃO: CARREGAR BOARD DO LOCALSTORAGE ESPECÍFICO
function carregarBoard(dadosSalvos) {
    const container = document.querySelector('.dashboard');
    if (!container) return;
    
    const addColumnBtn = container.querySelector('.add-column');
    
    //SE NÃO HOUVER DADOS SALVOS (Primeira vez que o usuário entra)
    if (!dadosSalvos) {
        document.querySelectorAll('.dashboard-column').forEach(coluna => {
            const cardsContainer = coluna.querySelector('.dashboard-cards');
            
            //Ativa o drag and drop e os botões da coluna padrão do HTML
            if (cardsContainer) ativarDropColuna(cardsContainer);
            ativarBotoesColuna(coluna); // Ativa os botões e a cor de forma limpa
            
            //ativa os comportamentos dos cards que já vierem fixos no HTML
            coluna.querySelectorAll('.dashboard-card').forEach(ativarDragCard);
            coluna.querySelectorAll('.badge').forEach(ativarPrioridade);
            coluna.querySelectorAll('.title-card').forEach(ativarTituloEditavel);
        });
        return;
    }
    
    //SE HOUVER DADOS SALVOS (Reconstrói o board do zero)
    const colunas = dadosSalvos;
    container.querySelectorAll('.dashboard-column').forEach(c => c.remove());
    
    colunas.forEach(colunaData => {
        const novaColuna = document.createElement('div');
        novaColuna.classList.add('dashboard-column');
        novaColuna.dataset.id = colunaData.id;
        colunaData.cor = MAPA_CORES[colunaData.cor] || colunaData.cor;
        novaColuna.style.setProperty('--column-color', colunaData.cor);
        
        const fotoUsuario = usuarioLogado.picture || 'imagens/porco.jpg';
        
        novaColuna.innerHTML = `
            <div class="dashboard-title">
                <div class="title-left">
                    <input type="color" class="color-picker" value="${colunaData.cor}" title="Mudar cor da coluna">
                    <h2>${esc(colunaData.titulo)}</h2>
                </div>
                <div class="column-actions">
                    <button class="add-card"><i class="fa-solid fa-plus"></i></button>
                    <button class="delete-column"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="dashboard-cards"></div>
        `;
        
        if (addColumnBtn) {
            container.insertBefore(novaColuna, addColumnBtn);
        } else {
            container.appendChild(novaColuna);
        }
        
        const cardsContainer = novaColuna.querySelector('.dashboard-cards');
        ativarDropColuna(cardsContainer);
        ativarBotoesColuna(novaColuna); //ativa botões e cor sem duplicar nada
        
        colunaData.cards.forEach(cardData => {
            const card = document.createElement('div');
            card.classList.add('dashboard-card');
            card.dataset.cardId = cardData.id;
            
            card.innerHTML = `
                <div class="badge ${cardData.priority}" data-priority="${cardData.priority}">
                    <span>${PRIO_TEXTO[cardData.priority] || esc(cardData.priorityText)}</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </div>
                <p class="title-card">${esc(cardData.title)}</p>
                <div class="card-infos">
                    <div class="user">
                        <img src="${fotoUsuario}" alt="user">
                        <i class="fa-solid fa-trash delete-card"></i>
                    </div>
                </div>
            `;
            
            cardsContainer.appendChild(card);
            ativarDragCard(card);
            ativarPrioridade(card.querySelector('.badge'));
            ativarTituloEditavel(card.querySelector('.title-card'));
        });
    });
}


//sistema de drag and drop
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.dashboard-card:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function ativarDropColuna(column) {
    column.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = document.querySelector('.dragging');
        if (!dragging) return;
        
        e.currentTarget.classList.add('cards-hover');
        const afterElement = getDragAfterElement(column, e.clientY);
        
        if (afterElement == null) {
            column.appendChild(dragging);
        } else {
            column.insertBefore(dragging, afterElement);
        }
    });

    column.addEventListener('dragleave', e => {
        if (e.target === e.currentTarget) {
            e.currentTarget.classList.remove('cards-hover');
        }
    });

    column.addEventListener('drop', e => {
        e.currentTarget.classList.remove('cards-hover');
        salvarBoard();
    });
}

function ativarDragCard(card) {
    card.setAttribute('draggable', 'true');
    
    card.addEventListener('dragstart', e => {
        if (e.target.classList.contains('title-card') || 
            e.target.closest('.badge') || 
            e.target.classList.contains('delete-card')) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', '');
        e.currentTarget.classList.add('dragging');
    });

    card.addEventListener('dragend', e => {
        e.currentTarget.classList.remove('dragging');
    });
}


//menus, edições e eventos de card
function ativarPrioridade(badge) {
    if (!badge) return;
    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        
        document.querySelectorAll('.priority-menu').forEach(m => m.remove());
        
        const menu = document.createElement('div');
        menu.classList.add('priority-menu', 'active');
        menu.innerHTML = `
            <div class="priority-option" data-priority="high">Alta prioridade</div>
            <div class="priority-option" data-priority="medium">Média prioridade</div>
            <div class="priority-option" data-priority="low">Baixa prioridade</div>
        `;
        document.body.appendChild(menu);
        
        const badgeRect = badge.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const spaceBelow = window.innerHeight - badgeRect.bottom;
        
        menu.style.left = `${badgeRect.left}px`;
        menu.style.width = `${Math.max(badgeRect.width, 170)}px`;
        
        if (spaceBelow < menuRect.height + 10 && badgeRect.top > menuRect.height + 10) {
            menu.style.top = `${badgeRect.top - menuRect.height - 6}px`;
        } else {
            menu.style.top = `${badgeRect.bottom + 6}px`;
        }
        
        menu.querySelectorAll('.priority-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.stopPropagation();
                const newPriority = option.dataset.priority;
                const newText = option.textContent;
                
                badge.classList.remove('high', 'medium', 'low');
                badge.classList.add(newPriority);
                badge.dataset.priority = newPriority;
                badge.querySelector('span').textContent = newText;
                
                menu.remove();
                salvarBoard();
            });
        });
    });
}

function ativarTituloEditavel(title) {
    if (!title) return;
    title.setAttribute('contenteditable', 'true');
    title.setAttribute('spellcheck', 'false');

    title.addEventListener('blur', (e) => {
        const novoTexto = e.target.textContent.trim();
        if (novoTexto === '') {
            e.target.textContent = 'Nova tarefa';
        }
        salvarBoard();
    });

    title.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.target.blur();
        }
    });

    title.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });
}

function criarCard(cardsContainer) {
    const card = document.createElement('div');
    card.classList.add('dashboard-card');
    card.dataset.cardId = Date.now().toString();
    
    const fotoUsuario = usuarioLogado.picture || 'imagens/porco.jpg';

    card.innerHTML = `
        <div class="badge low" data-priority="low">
            <span>Baixa prioridade</span>
            <i class="fa-solid fa-chevron-down"></i>
        </div>
        <p class="title-card">Nova tarefa</p>
        <div class="card-infos">
            <div class="user">
                <img src="${fotoUsuario}" alt="user">
                <i class="fa-solid fa-trash delete-card"></i>
            </div>
        </div>
    `;
    
    cardsContainer.appendChild(card);
    
    ativarDragCard(card);
    ativarPrioridade(card.querySelector('.badge'));
    ativarTituloEditavel(card.querySelector('.title-card'));
    
    const title = card.querySelector('.title-card');
    title.focus();
    document.getSelection().selectAllChildren(title);
    
    salvarBoard();
}

function ativarSeletorCor(coluna) {
    const colorPicker = coluna.querySelector('.color-picker');
    if (!colorPicker) return;
    
    colorPicker.addEventListener('input', (e) => {
        const novaCor = e.target.value;
        coluna.style.setProperty('--column-color', novaCor);
        salvarBoard();
    });
}

function ativarBotoesColuna(coluna) {
    const addCardBtn = coluna.querySelector('.add-card');
    if (addCardBtn) {
        addCardBtn.addEventListener('click', () => {
            const cardsContainer = coluna.querySelector('.dashboard-cards');
            criarCard(cardsContainer);
        });
    }
    
    const deleteColumnBtn = coluna.querySelector('.delete-column');
    if (deleteColumnBtn) {
        deleteColumnBtn.addEventListener('click', () => {
            if (confirm('Deletar essa coluna e todos os cards?')) {
                coluna.remove();
                salvarBoard();
            }
        });
    }
    
    const tituloColuna = coluna.querySelector('.dashboard-title h2');
    if (tituloColuna) {
        tituloColuna.setAttribute('contenteditable', 'true');
        tituloColuna.setAttribute('spellcheck', 'false');
        
        tituloColuna.addEventListener('blur', (e) => {
            if (e.target.textContent.trim() === '') {
                e.target.textContent = 'Nova coluna';
            }
            salvarBoard();
        });
        
        tituloColuna.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });
    }

    ativarSeletorCor(coluna);
}

//botão Global para adicionar colunas
const addColumnBtn = document.querySelector('.add-column');
if (addColumnBtn) {
    addColumnBtn.addEventListener('click', () => {
        const container = document.querySelector('.dashboard');
        
        const novaColuna = document.createElement('div');
        novaColuna.classList.add('dashboard-column');
        novaColuna.dataset.id = Date.now();
        novaColuna.style.setProperty('--column-color', '#8b5cf6');
        
        novaColuna.innerHTML = `
            <div class="dashboard-title">
                <div class="title-left">
                    <input type="color" class="color-picker" value="#8b5cf6" title="Mudar cor da coluna">
                    <h2>Nova coluna</h2>
                </div>
                <div class="column-actions">
                    <button class="add-card"><i class="fa-solid fa-plus"></i></button>
                    <button class="delete-column"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="dashboard-cards"></div>
        `;
        
        container.insertBefore(novaColuna, addColumnBtn);
        
        const cardsContainer = novaColuna.querySelector('.dashboard-cards');
        ativarDropColuna(cardsContainer);
        ativarBotoesColuna(novaColuna);
        
        const tituloColuna = novaColuna.querySelector('h2');
        tituloColuna.focus();
        document.getSelection().selectAllChildren(tituloColuna);
        
        salvarBoard();
    });
}


//central de cliques
const avatarBtn = document.getElementById('user-avatar');
const userDropdown = document.getElementById('user-dropdown');

document.addEventListener('click', (e) => {
    //fecha menus de prioridade abertos ao clicar em qualquer lugar
    document.querySelectorAll('.priority-menu').forEach(m => m.remove());
    
    //lógica para deletar o card se clicar na lixeira
    if (e.target.classList.contains('delete-card')) {
        e.stopPropagation();
        const card = e.target.closest('.dashboard-card');
        if (card) {
            card.remove();
            salvarBoard(); 
        }
        return;
    }

    //lógica unificada do Dropdown de Avatar
    if (avatarBtn && userDropdown) {
        if (avatarBtn.contains(e.target)) {
            e.stopPropagation();
            userDropdown.classList.toggle('hidden'); //abre/fecha se clicar no botão do avatar
        } else {
            userDropdown.classList.add('hidden'); //fecha se clicar fora de tudo
        }
    }
});

//fecha o menu de prioridades no Scroll da página
document.addEventListener('scroll', () => {
    document.querySelectorAll('.priority-menu').forEach(m => m.remove());
}, true);

// Evento de Logout
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).finally(() => window.location.href = 'inicial.html');
    });
}


//inicialização: mantém o login (Firebase) e carrega o board
onAuthStateChanged(auth, user => {
    if (!user) { window.location.href = 'inicial.html'; return; }
    iniciar(user);
});
