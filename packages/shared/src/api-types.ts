import type { EntityType } from './constants.js';

export interface Page<T> { items: T[]; nextCursor: string | null; total?: number }

export interface ProblemDetails {
  type: string; title: string; status: number; detail?: string;
  instance?: string; errors?: Record<string, string[]>;
}

export interface EntityRef { type: EntityType; id: string; label?: string }

export interface DashboardPayload {
  today: string;
  counts: {
    tasksDueToday: number; tasksOverdue: number; maintenanceDue: number;
    expiringSoon: number; lowStock: number; dosesDueToday: number;
    activeProjects: number; loansOut: number; warrantiesExpiring: number;
    billsDueSoon: number;
  };
  tasks: Array<{
    id: string; title: string; dueDate: string | null; status: string; priority: string;
    origin: string; originId: string | null; assignees: string[]; overdue: boolean;
  }>;
  expiring: Array<{ id: string; product: string; quantity: number; unit: string; expiryDate: string; location: string | null; daysLeft: number }>;
  lowStock: Array<{ productId: string; name: string; onHand: number; unit: string; minQuantity: number }>;
  projects: Array<{ id: string; name: string; status: string; taskDone: number; taskTotal: number; budget: number | null; spent: number; pctBudget: number | null }>;
  budget: { month: string; allocated: number; spent: number; currency: string; overCategories: Array<{ id: string; name: string; allocated: number; spent: number }> };
  bills: Array<{ id: string; payee: string; amount: number | null; dueDate: string }>;
  doses: Array<{ id: string; petId: string; petName: string; medication: string; dueAt: string; status: string }>;
  warranties: Array<{ assetId: string; assetName: string; expiry: string; daysLeft: number }>;
  loans: Array<{ id: string; item: string; contact: string; dueBack: string | null; overdue: boolean }>;
}
