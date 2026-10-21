(function () {
  const CFG = window.NB_CONFIG || {};
  const f = document.getElementById('login'), err = document.getElementById('err');
  const ok = window.supabase && CFG.url && CFG.anonKey && !/XXXX|COLLER/.test(CFG.url + CFG.anonKey);
  if (!ok) { err.textContent = 'L’appli n’est pas encore reliée à Supabase : remplissez config.js (voir le guide).'; f.querySelector('#submit').disabled = true; return; }
  const sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const wait = document.getElementById('wait');
  const mode = () => f.elements.mode.value;
  f.addEventListener('change', () => {
    const up = mode() === 'up';
    f.querySelector('#submit').textContent = up ? 'Créer mon compte' : 'Se connecter';
    f.querySelector('#password').autocomplete = up ? 'new-password' : 'current-password';
    err.textContent = '';
  });
  async function goIfMember() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return false;
    const { data } = await sb.from('members').select('user_id').eq('user_id', session.user.id);
    if (data && data.length) { location.replace('budget.html'); return true; }
    wait.hidden = false; return false;
  }
  if (new URLSearchParams(location.search).has('attente')) wait.hidden = false;
  goIfMember();
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    const email = f.querySelector('#email').value.trim(), password = f.querySelector('#password').value;
    if (!email || !password) { err.textContent = 'Entrez votre e-mail et votre mot de passe.'; return; }
    if (mode() === 'up') {
      if (password.length < 8) { err.textContent = 'Choisissez un mot de passe d’au moins 8 caractères.'; return; }
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) { err.textContent = error.message; return; }
      if (!data.session) { err.textContent = 'Compte créé : ouvrez l’e-mail de confirmation, puis revenez vous connecter.'; return; }
      wait.hidden = false; return;
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { err.textContent = /invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect.' : error.message; return; }
    await goIfMember();
  });
})();
