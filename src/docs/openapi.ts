/** Spécification OpenAPI — alignée sur les routes Express sous `/api/v1`. */

const bearer = { bearerAuth: [] as const };

const ok = { '200': { description: 'OK' } };
const created = { '201': { description: 'Créé' } };
const noContent = { '204': { description: 'Supprimé' } };
const unauthorized = { '401': { description: 'Non autorisé' } };
const forbidden = { '403': { description: 'Interdit' } };
const notFound = { '404': { description: 'Introuvable' } };

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'TimeTutor API',
    version: '1.0.0',
    description:
      'API TimeTutor. JWT en en-tête `Authorization: Bearer <token>` pour la plupart des routes ; liens magiques et refresh via cookies selon les endpoints.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Health', description: 'Santé du service' },
    { name: 'Auth', description: 'Authentification' },
    { name: 'Sessions', description: 'Sessions de planification' },
    { name: 'Slots', description: 'Créneaux (liés à une session)' },
    { name: 'Teachers', description: 'Enseignants (global et par session)' },
    { name: 'Admin', description: 'Administration et abonnements' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: { '200': { description: 'Service disponible' } },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Inscription établissement (directeur)',
        responses: { ...ok, '400': { description: 'Données invalides' } },
      },
    },
    '/auth/register-teacher': {
      post: {
        tags: ['Auth'],
        summary: 'Inscription enseignant (compte)',
        responses: { ...ok, '400': { description: 'Données invalides' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Connexion',
        responses: { ...ok, '401': { description: 'Identifiants invalides' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rafraîchir le token (cookie refresh)',
        responses: { ...ok, ...unauthorized },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Déconnexion',
        responses: { ...ok },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Utilisateur courant',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
    },
    '/sessions': {
      get: {
        tags: ['Sessions'],
        summary: 'Lister les sessions',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
      post: {
        tags: ['Sessions'],
        summary: 'Créer une session',
        security: [bearer],
        responses: { ...created, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{id}': {
      get: {
        tags: ['Sessions'],
        summary: 'Détail session',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...notFound },
      },
      put: {
        tags: ['Sessions'],
        summary: 'Mettre à jour une session',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden, ...notFound },
      },
      delete: {
        tags: ['Sessions'],
        summary: 'Supprimer une session',
        security: [bearer],
        responses: { ...noContent, ...unauthorized, ...forbidden, ...notFound },
      },
    },
    '/sessions/{id}/export/pdf': {
      get: {
        tags: ['Sessions'],
        summary: 'Exporter la session en PDF',
        security: [bearer],
        responses: { '200': { description: 'Fichier PDF' }, ...unauthorized, ...notFound },
      },
    },
    '/sessions/{id}/status': {
      put: {
        tags: ['Sessions'],
        summary: 'Mettre à jour le statut',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden, ...notFound },
      },
    },
    '/sessions/{sessionId}/slots': {
      get: {
        tags: ['Slots'],
        summary: 'Lister les créneaux (JWT)',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
      post: {
        tags: ['Slots'],
        summary: 'Créer un créneau',
        security: [bearer],
        responses: { ...created, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/slots/batch': {
      post: {
        tags: ['Slots'],
        summary: 'Créer des créneaux en lot',
        security: [bearer],
        responses: { ...created, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/slots/{slotId}/validate': {
      post: {
        tags: ['Slots'],
        summary: 'Valider un créneau',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/slots/{slotId}/unvalidate': {
      post: {
        tags: ['Slots'],
        summary: 'Annuler la validation',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/slots/teacher/{token}': {
      get: {
        tags: ['Slots'],
        summary: 'Lister les créneaux (lien magique enseignant)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/sessions/{sessionId}/slots/{slotId}/select/{token}': {
      post: {
        tags: ['Slots'],
        summary: 'Sélectionner un créneau (magique)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
      delete: {
        tags: ['Slots'],
        summary: 'Désélectionner un créneau (magique)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/sessions/{sessionId}/slots/{slotId}/contact/{token}': {
      post: {
        tags: ['Slots'],
        summary: 'Demande de contact / échange (magique)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/sessions/{sessionId}/slots/negotiations/{token}': {
      get: {
        tags: ['Slots'],
        summary: 'Lister les négociations de créneaux (enseignant, lien magique)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/sessions/{sessionId}/slots/negotiations/{negotiationId}/choose/{token}': {
      post: {
        tags: ['Slots'],
        summary: 'Choisir un créneau dans une négociation (enseignant, lien magique)',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/sessions/{sessionId}/slots/negotiations': {
      get: {
        tags: ['Slots'],
        summary: 'Vue globale des négociations de la session (directeur)',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/teachers': {
      get: {
        tags: ['Teachers'],
        summary: 'Lister les enseignants de la session',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
      post: {
        tags: ['Teachers'],
        summary: 'Ajouter un enseignant à la session',
        security: [bearer],
        responses: { ...created, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/teachers/import': {
      post: {
        tags: ['Teachers'],
        summary: 'Importer des enseignants (CSV)',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/teachers/{teacherId}': {
      delete: {
        tags: ['Teachers'],
        summary: 'Retirer un enseignant',
        security: [bearer],
        responses: { ...noContent, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/teachers/{teacherId}/invite': {
      post: {
        tags: ['Teachers'],
        summary: 'Inviter un enseignant',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/sessions/{sessionId}/teachers/{teacherId}/remind': {
      post: {
        tags: ['Teachers'],
        summary: 'Relancer un enseignant',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/teachers/verify/{token}': {
      get: {
        tags: ['Teachers'],
        summary: 'Vérifier un token magique',
        responses: { ...ok, '401': { description: 'Token invalide' } },
      },
    },
    '/teachers/my-sessions': {
      get: {
        tags: ['Teachers'],
        summary: 'Sessions de l’enseignant connecté',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/teachers': {
      get: {
        tags: ['Teachers'],
        summary: 'Lister les enseignants (JWT, contexte établissement)',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
      post: {
        tags: ['Teachers'],
        summary: 'Ajouter un enseignant',
        security: [bearer],
        responses: { ...created, ...unauthorized, ...forbidden },
      },
    },
    '/teachers/import': {
      post: {
        tags: ['Teachers'],
        summary: 'Importer enseignants (CSV)',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/teachers/{id}': {
      delete: {
        tags: ['Teachers'],
        summary: 'Supprimer un enseignant',
        security: [bearer],
        responses: { ...noContent, ...unauthorized, ...forbidden },
      },
    },
    '/teachers/{id}/invite': {
      post: {
        tags: ['Teachers'],
        summary: 'Inviter',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/teachers/{id}/remind': {
      post: {
        tags: ['Teachers'],
        summary: 'Relancer',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/notifications': {
      get: {
        tags: ['Admin'],
        summary: 'Lister les notifications',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
    },
    '/admin/notifications/{id}/read': {
      put: {
        tags: ['Admin'],
        summary: 'Marquer une notification lue',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
    },
    '/admin/notifications/read-all': {
      put: {
        tags: ['Admin'],
        summary: 'Tout marquer comme lu',
        security: [bearer],
        responses: { ...ok, ...unauthorized },
      },
    },
    '/admin/me/subscription': {
      get: {
        tags: ['Admin'],
        summary: 'Abonnement du directeur',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/schools': {
      get: {
        tags: ['Admin'],
        summary: 'Lister les écoles (super admin)',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/stats': {
      get: {
        tags: ['Admin'],
        summary: 'Statistiques globales',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/schools/{id}/toggle': {
      put: {
        tags: ['Admin'],
        summary: 'Activer / désactiver une école',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/plans': {
      get: {
        tags: ['Admin'],
        summary: 'Lister les plans',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
    '/admin/schools/{id}/subscription': {
      get: {
        tags: ['Admin'],
        summary: 'Abonnement d’une école',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
      put: {
        tags: ['Admin'],
        summary: 'Mettre à jour l’abonnement d’une école',
        security: [bearer],
        responses: { ...ok, ...unauthorized, ...forbidden },
      },
    },
  },
};

