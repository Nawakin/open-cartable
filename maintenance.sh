#!/bin/sh
set +x
set -eu
cd -- "$(dirname -- "$0")"

if ! ( : </dev/tty ) 2>/dev/null; then
  printf '%s\n' 'Ouvrez un terminal pour utiliser le menu de maintenance.' >&2
  exit 1
fi
exec 3<>/dev/tty
printf '%s\n' 'Maintenance Open Cartable' '1. Changer le mot de passe de direction' \
  '2. Réinitialiser la double authentification de direction' '0. Quitter' >&3
printf 'Votre choix > ' >&3
IFS= read -r choice <&3 || exit 1
case "$choice" in
  0) exit 0 ;;
  1|2) ;;
  *) printf '%s\n' 'Choix non valide.' >&2; exit 1 ;;
esac

program=$(cat <<'JS'
import { openDatabase, transaction } from './apps/api/db/database.js';
import { hashPassword, validPassword } from './apps/api/auth/password.js';
import { setDirectionPassword } from './apps/api/direction/store.js';

const [, command, code] = process.argv;
const db = openDatabase(process.env.DATABASE_URL);
try {
  if (command === 'list') {
    const { rows } = await db.query('SELECT code FROM schools ORDER BY code');
    for (const school of rows) console.log(school.code);
  } else if (command === 'totp') {
    await transaction(db, async (client) => {
      const { rows: [school] } = await client.query('SELECT id FROM schools WHERE code = $1', [code]);
      if (!school) throw new Error('École introuvable.');
      await client.query(`
        UPDATE direction_accounts SET totp_secret = NULL, totp_step = NULL, totp_pending = NULL,
          totp_pending_session = NULL, totp_pending_until = NULL, totp_failed_attempts = 0, totp_failed_until = NULL
        WHERE school_id = $1
      `, [school.id]);
      await client.query('DELETE FROM direction_sessions WHERE school_id = $1', [school.id]);
      await client.query("DELETE FROM direction_recovery_tokens WHERE school_id = $1 AND purpose = 'reset'", [school.id]);
    });
    console.log('Double authentification réinitialisée. Les anciennes sessions direction sont fermées.');
  } else {
    let input = '';
    for await (const chunk of process.stdin.setEncoding('utf8')) {
      input += chunk;
      if (input.length > 1024) throw new Error('Mot de passe trop long.');
    }
    const [password, confirmation, end, ...extra] = input.split('\n');
    if (!validPassword(password) || end !== '' || extra.length) {
      throw new Error('Choisissez un mot de passe de 15 à 128 caractères.');
    }
    if (password !== confirmation) throw new Error('Les deux saisies sont différentes.');
    const credential = await hashPassword(password);
    await transaction(db, async (client) => {
      const { rows: [school] } = await client.query('SELECT id FROM schools WHERE code = $1', [code]);
      if (!school) throw new Error('École introuvable.');
      await setDirectionPassword(client, school.id, credential);
    });
    console.log('Mot de passe enregistré. Les anciennes sessions direction sont fermées.');
  }
} catch (error) {
  console.error(error.code ? 'La modification du compte direction a échoué.' : error.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
JS
)

run_admin() {
  docker compose exec -T -w /app api node --input-type=module -e "$program" -- "$@"
}

schools=$(run_admin list) || exit 1
if [ -z "$schools" ]; then
  printf '%s\n' 'Aucune école configurée.' >&2
  exit 1
fi
case "$schools" in
  *'
'*)
    printf '%s\n' "$schools" | awk '{ print NR ". " $0 }' >&3
    printf 'Numéro de l’école > ' >&3
    IFS= read -r school_choice <&3 || exit 1
    case "$school_choice" in
      ''|*[!0-9]*) printf '%s\n' 'Choix d’école non valide.' >&2; exit 1 ;;
    esac
    school=$(printf '%s\n' "$schools" | awk -v selected="$school_choice" 'NR == selected { print; exit }')
    [ -n "$school" ] || { printf '%s\n' 'Choix d’école non valide.' >&2; exit 1; }
    ;;
  *) school=$schools ;;
esac
printf 'École sélectionnée · %s\n' "$school" >&3

if [ "$choice" = 2 ]; then
  printf 'Pour retirer l’authentificateur de cette école, tapez OUI > ' >&3
  IFS= read -r confirmation <&3 || exit 1
  [ "$confirmation" = OUI ] || exit 0
  run_admin totp "$school"
  exit 0
fi

tty_state=$(stty -g <&3)
trap 'stty "$tty_state" <&3' 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
stty -echo <&3
printf 'Nouveau mot de passe (15 à 128 caractères) > ' >&3
IFS= read -r password <&3 || exit 1
printf '\nRetapez le nouveau mot de passe > ' >&3
IFS= read -r confirmation <&3 || exit 1
stty "$tty_state" <&3
trap - 0 INT TERM HUP
printf '\n' >&3
printf '%s\n%s\n' "$password" "$confirmation" | run_admin reset "$school"
