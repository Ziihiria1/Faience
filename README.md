# Faïence à deux

Jeu de tuiles de faïence à deux joueurs, chacun sur son téléphone. Site statique pour GitHub Pages ; les parties transitent par une base Firebase Realtime Database gratuite.

## Fonctionnement

- Chaque téléphone a son profil (nom + emblème), enregistré sur le téléphone.
- **Nouvelle partie** crée un salon avec un code à 5 caractères (sans I, O, 0 ni 1).
- **Rejoindre une partie** : l'autre joueur tape ce code, ou ouvre le lien partagé. La partie démarre aussitôt.
- La partie se joue téléphone à l'horizontale. Si la rotation automatique est bloquée, l'écran se tourne tout seul : tourne le téléphone vers la gauche.
- L'icône à quatre carrés (ou la vignette de l'adversaire) affiche son plateau.
- La partie reste dans le salon : on peut fermer la page et reprendre plus tard depuis « Tes salons ». En fin de partie, **Revanche** relance dans le même salon et le compteur de victoires continue.

## Installation (une fois, ~10 minutes)

### 1. Créer la base Firebase

1. Va sur <https://console.firebase.google.com> avec un compte Google, puis **Créer un projet** (Google Analytics inutile).
2. Menu **Créer › Realtime Database › Créer une base de données**. Emplacement : **Belgique (europe-west1)**. Mode : **verrouillé**.
3. Onglet **Règles** : remplace tout par le contenu de `database.rules.json`, puis **Publier**.

### 2. Déclarer l'application Web

1. Roue dentée **Paramètres du projet › Général › Vos applications**, icône **`</>`** (Web). Donne un nom, pas besoin d'hébergement Firebase.
2. Firebase affiche un bloc `const firebaseConfig = { … }`. Copie ses valeurs dans `config.js` à la place des `COLLE-ICI`.
3. Vérifie que `databaseURL` est présent (si le bloc ne l'affiche pas, copie l'URL en haut de l'onglet Realtime Database, du type `https://xxx-default-rtdb.europe-west1.firebasedatabase.app`).

Ces valeurs ne sont pas secrètes : elles identifient la base. La sécurité vient des règles (on ne peut lire un salon qu'en connaissant son code, et on ne peut pas lister les salons).

### 3. Publier sur GitHub Pages

1. Crée un dépôt sur GitHub et dépose-y tous les fichiers de ce dossier (bouton **Add file › Upload files**).
2. **Settings › Pages › Build and deployment** : Source **Deploy from a branch**, branche **main**, dossier **/ (root)**, **Save**.
3. Une à deux minutes plus tard, le site est en ligne à `https://<ton-pseudo>.github.io/<nom-du-depot>/`.

### 4. Sur vos téléphones

1. Ouvrez l'adresse, créez chacun votre profil.
2. Conseillé : **Ajouter à l'écran d'accueil** (Safari : bouton Partager ; Chrome : menu ⋮). Le jeu s'ouvre alors en plein écran, sans barres du navigateur, et le plateau est plus grand.

## Tester sans Firebase

Ouvre `index.html?local` (ou le bouton « Tester sur cet appareil ») dans deux onglets du même navigateur, un profil par onglet. Les salons restent dans ce navigateur.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | Page unique |
| `style.css` | Mise en forme (portrait pour les menus, paysage pour la partie) |
| `engine.js` | Règles du jeu (pur, sans réseau) |
| `backend.js` | Accès Firebase, et stockage local pour le mode test |
| `app.js` | Écrans et interactions |
| `config.js` | Configuration Firebase à remplir |
| `database.rules.json` | Règles de sécurité à coller dans Firebase |
| `manifest.webmanifest`, `icon-*.png` | Installation sur l'écran d'accueil |

## Limites connues

- Pas de notification quand c'est ton tour si l'application est fermée. Page ouverte : le titre affiche « ● À toi » et Android vibre.
- Les profils ne sont pas protégés par mot de passe : quelqu'un qui connaît le code d'un salon et ouvre le site peut y lire la partie. Les codes ne sont pas listables.
- Quota gratuit Firebase (Spark) : 1 Go stocké, 10 Go transférés par mois, 100 connexions simultanées. Une partie pèse quelques kilo-octets.
