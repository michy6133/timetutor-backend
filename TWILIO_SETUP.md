# Twilio WhatsApp - Configuration de base

Ce document donne une base propre pour rendre les notifications WhatsApp operationnelles dans TimeTutor.

## 1) Prerequis Twilio

- Creer un compte Twilio.
- Activer le produit **Messaging**.
- Activer un expéditeur WhatsApp:
  - soit **WhatsApp Sandbox** (developpement rapide),
  - soit un numero WhatsApp Business approuve (production).
- Recuperer les secrets:
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_WHATSAPP_FROM` (format `whatsapp:+14155238886`)

## 2) Variables d'environnement

Ajouter ces variables dans l'environnement backend (fichier `.env` local, variables de plateforme en staging/prod):

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_MESSAGING_ENABLED=true
APP_BASE_URL=https://votre-domaine.com
```

Notes:
- En local, vous pouvez mettre `TWILIO_MESSAGING_ENABLED=false` pour des tests sans envoi reel.
- Ne jamais versionner `TWILIO_AUTH_TOKEN` dans Git.

## 3) Installation backend

Installer le SDK Twilio dans le backend:

```bash
npm install twilio
```

## 4) Contrat de service recommande

Brancher l'envoi WhatsApp dans le service de notifications existant:
- Fichier cible: `src/services/notification.service.ts`
- Responsabilites:
  - formatter le numero destinataire (E.164),
  - selectionner un template par type d'evenement,
  - envoyer via Twilio si `TWILIO_MESSAGING_ENABLED=true`,
  - logger succes/erreur sans exposer les secrets.

Exemples d'evenements a couvrir:
- Rappels de session
- Alertes importantes
- Nouvelles affectations d'enseignants

## 5) Format d'envoi WhatsApp

Regles minimales:
- `from`: `whatsapp:+...` (expediteur Twilio)
- `to`: `whatsapp:+...` (destinataire en E.164)
- `body`: message texte clair, court, actionnable

Exemple de payload logique:

```json
{
  "from": "whatsapp:+14155238886",
  "to": "whatsapp:+2250700000000",
  "body": "TimeTutor: vous avez une nouvelle affectation pour la session Terminale S, mardi 08:00."
}
```

## 6) Rendre operationnel (checklist)

- [ ] Variables Twilio configurees sur l'environnement cible.
- [ ] Expéditeur WhatsApp valide (Sandbox ou Business approuve).
- [ ] SDK `twilio` installe dans le backend.
- [ ] Service de notifications relie a Twilio.
- [ ] Au moins un endpoint/fonction metier declenche l'envoi (rappel/alerte/affectation).
- [ ] Logs d'erreurs Twilio visibles cote serveur (sans token).
- [ ] Test E2E valide sur un vrai numero de test.

## 7) Passage production

Avant go-live:
- Passer de Sandbox a un numero WhatsApp Business approuve.
- Mettre en place des templates approuves si necessaire (selon politique WhatsApp).
- Ajouter une politique d'opt-in/opt-out utilisateur.
- Ajouter des garde-fous:
  - rate limiting par numero,
  - retries limites,
  - deduplication de notifications.

## 8) Troubleshooting rapide

- **Erreur 401/403 Twilio**: verifier `ACCOUNT_SID` et `AUTH_TOKEN`.
- **Message non livre**: verifier format E.164 et statut WhatsApp du destinataire.
- **Aucun envoi**: verifier `TWILIO_MESSAGING_ENABLED` et logs serveur.
- **Expediteur invalide**: verifier `TWILIO_WHATSAPP_FROM` au format `whatsapp:+...`.

