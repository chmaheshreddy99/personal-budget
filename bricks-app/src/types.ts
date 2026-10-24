/** What the server sends: Brick Management's views (see BrickController and its services on the server). */

export type ModuleKey = 'DASHBOARD' | 'APPROVALS' | 'ORDERS' | 'DELIVERIES' | 'PAYMENTS' | 'STOCK' | 'PRODUCTION' | 'PURCHASES' | 'TEAM'
  | 'CASHBOOK' | 'REPORTS' | 'ALERTS';

export type Permission = 'STOCK' | 'PRODUCTION' | 'PURCHASES' | 'SALES' | 'FINANCE' | 'APPROVE' | 'SETUP';

/** GET /api/bricks/app/profile: who is signed in, their screens and what they may do on the phone. */
export type Profile = {
  userId: number; fullName: string; username: string; organization: string; company: string | null; companyPhone: string | null;
  currency: string; role: string; roleLabel: string; permissions: Permission[]; modules: ModuleKey[];
  decide: boolean; record: boolean; evidence: boolean; pendingApprovals: number; unreadNotices: number; locked: string | null; serverTime: string;
  /** the organization's company name and logo (an address on the server): web app, Settings → Organization */
  brandName?: string | null; brandLogo?: string | null;
};

export type BrickType = { id: number; name: string; mrp: number | null; minPrice: number | null; curingDays: number | null; color: string | null;
  active: boolean | null; sortOrder: number | null };
export type Material = { id: number; name: string; unit: string; reorderLevel: number | null; lastRate: number | null; currentStock: number | null;
  active: boolean | null };
export type Vehicle = { id: number; number: string; kind: string | null; capacity: number; driverId: number | null; active: boolean | null };
export type Resource = { id: number; name: string; kind: string; role: string; salaryType: string; salaryAmount: number | null; phone: string | null;
  upiId: string | null; active: boolean | null; defaultTeam: boolean | null; category: string | null; memberCount: number | null; members: string | null };
export type Meta = {
  settings: { deliveryChargePerTrip: number | null; freeDeliveryMinQty: number | null; companyName: string | null; phone: string | null;
    upiId: string | null; receiptAccountId: number | null; payAccountId: number | null; payDay: number | null; address: string | null;
    ownerName: string | null; ownerSignature: string | null; accountantName: string | null; accountantSignature: string | null };
  types: BrickType[]; materials: Material[];
  models: { model: { id: number; name: string; defaultModel: boolean | null; active: boolean | null } }[];
  vehicles: Vehicle[]; resources: Resource[]; expenseHeads: string[]; roles: string[];
};

export type MoneyAccount = { id: number; name: string; accountClass: string; accountType: string; active: boolean; brickBook: boolean };

export type Step = { action: string; at: string; by: string | null; note: string | null };

export type OrderItemInput = { brickTypeId: number; quantity: number; price: number };
export type OrderRequest = {
  orderDate: string; requiredBy?: string | null; customerName: string; customerPhone?: string | null; address?: string | null;
  landmark?: string | null; items: OrderItemInput[]; note?: string | null; waiveDelivery?: boolean | null; waiveReason?: string | null;
  deliveryChargePerTrip?: number | null; hired?: boolean | null; hiredVehicle?: string | null;
};

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

export type Approval = {
  id: number; approvalNo: string; kind: string; kindLabel: string; status: ApprovalStatus; orderId: number | null;
  orderNo: string | null; customerName: string | null; summary: string; reasons: string[]; note: string | null; amount: number | null;
  requestedById: number | null; requestedBy: string | null; requestedAt: string; decidedBy: string | null; decidedAt: string | null;
  decisionNote: string | null; request: OrderRequest | null; resubmits: number; history: Step[]; attachmentCount: number;
  canDecide: boolean; canWithdraw: boolean; canResubmit: boolean; canAttach: boolean;
};

export type Attachment = { id: number; journalEntryId: number | null; fileName: string; contentType: string; sizeBytes: number;
  width: number | null; height: number | null; image: boolean; pdf: boolean; hasThumbnail: boolean; source: string | null;
  caption: string | null; createdBy: string | null; createdAt: string };

export type OrderRow = {
  id: number; orderNo: string; orderDate: string; requiredBy: string | null; customerName: string; customerPhone: string | null;
  address: string | null; quantity: number; delivered: number; total: number; paid: number; balance: number; status: string;
  statusLabel: string; trips: number; tripsDone: number; nextTrip: string | null; vehicle: string | null; claimed: boolean;
  tripDates: string[]; lastDelivered: string | null; hired: boolean;
};

export type ItemView = { brickTypeId: number; name: string; color: string | null; quantity: number; mrp: number | null; price: number;
  discountPerBrick: number | null; discountPercent: number | null; discount: number | null; amount: number; delivered: number;
  onTheWay: number; planned: number; pending: number };
export type Trip = { id: number; tripNo: number; status: string; scheduledOn: string | null; loadingAt: string | null;
  dispatchedAt: string | null; inTransitAt: string | null; deliveredAt: string | null; ackName: string | null; ackAt: string | null;
  note: string | null };
export type TripItem = { brickTypeId: number; name: string; color: string | null; quantity: number; delivered: number | null };
export type TripView = { trip: Trip; items: TripItem[]; quantity: number; delivered: number | null; vehicle: string | null;
  vehicleKind: string | null; driver: string | null; driverPhone: string | null; loadingTeam: string | null; unloadingTeam: string | null;
  billed: number | null; entryNo: string | null; acknowledged: boolean };
export type Payment = { id: number; receiptNo: string | null; receivedOn: string; amount: number; mode: string | null;
  reference: string | null; accountId: number | null; status: string; note: string | null; createdBy: string | null; createdAt: string };
export type PaymentView = { payment: Payment; account: string | null; entryNo: string | null };
export type Totals = { quantity: number; atMrp: number; discount: number; bricks: number; trips: number; deliveryPerTrip: number;
  delivery: number; handling: number; total: number; delivered: number; pending: number; billed: number; paid: number; claimed: number;
  balance: number; dueNow: number };
export type Order = {
  id: number; orderNo: string; orderDate: string; requiredBy: string | null; customerName: string; customerPhone: string | null;
  address: string | null; landmark: string | null; status: string; note: string | null; deliveryWaived: boolean | null;
  waiveReason: string | null; hired: boolean | null; hiredVehicle: string | null; deliveryLocation: string | null;
  createdBy: string | null; createdAt: string; vehicleId: number | null;
};
export type OrderView = { order: Order; items: ItemView[]; totals: Totals; trips: TripView[]; payments: PaymentView[];
  vehicle: string | null; vehicleCapacity: number | null; driver: string | null; loadingTeam: string | null; unloadingTeam: string | null;
  statusLabel: string; freeDeliveryQualifies: boolean };
export type Customer = { name: string; phone: string | null; address: string | null; landmark: string | null; orders: number;
  bricks: number; value: number; balance: number; lastOrder: string | null };

export type TypeStock = { brickTypeId: number; name: string; color: string | null; mrp: number | null; opening: number; produced: number;
  damaged: number; dispatched: number; delivered: number; inYard: number; curing: number; ready: number; booked: number; available: number };
export type MaterialStock = { materialId: number; name: string; unit: string; stock: number; reorderLevel: number | null;
  lastRate: number | null; avgDailyUse: number | null; daysLeft: number | null; low: boolean };
export type MaterialFlow = { materialId: number; name: string; unit: string; opening: number; received: number; closing: number | null;
  consumed: number | null; counted: boolean };
export type BatchItem = { brickTypeId: number; name: string; color: string | null; quantity: number; damaged: number; good: number;
  rate: number | null; amount: number | null };
export type BatchView = { batch: { id: number; batchNo: string; producedOn: string; teamId: number | null; note: string | null;
  createdBy: string | null }; teamName: string | null; modelName: string | null; items: BatchItem[]; total: number; damaged: number;
  good: number; labour: number | null; materials: MaterialFlow[]; paidOn: string | null; open: boolean };
export type PurchaseView = { purchase: { id: number; materialId: number; receivedOn: string; quantity: number; rate: number | null;
  amount: number | null; vendor: string | null; billNo: string | null; vehicleNo: string | null; journalEntryId: number | null;
  note: string | null; createdBy: string | null }; material: string; unit: string; account: string | null; entryNo: string | null };
export type ExpenseView = { expense: { id: number; head: string; description: string | null; vendor: string | null; billNo: string | null;
  amount: number; spentOn: string; journalEntryId: number | null; createdBy: string | null }; account: string | null;
  batchNo: string | null; entryNo: string | null };
export type Production = { batches: BatchView[]; stock: TypeStock[]; materials: MaterialStock[]; purchases: PurchaseView[];
  expenses: ExpenseView[]; stockIssues: { materialId: number; name: string }[] };

export type Kpis = { producedToday: number; producedWeek: number; producedMonth: number; inYard: number; ready: number; curing: number;
  booked: number; available: number; openOrders: number; pendingBricks: number; tripsToday: number; onTheWay: number; salesMonth: number;
  receiptsMonth: number; profitMonth: number; receivable: number; advancesHeld: number; wagesDue: number; advancesOutstanding: number;
  cashInBook: number; lowMaterials: number; overdueOrders: number; awaitingConfirmation: number };
export type Insight = { tone: string; icon: string; title: string; text: string };
export type MonthPoint = { month: string; revenue: number; materials: number; wages: number; expenses: number; profit: number;
  margin: number | null; produced: number; delivered: number };
export type WeekPoint = { label: string; weekStart: string; produced: number; delivered: number; sales: number };
export type UpcomingTrip = { orderId: number; orderNo: string; tripNo: number; customer: string; status: string; scheduledOn: string | null;
  bricks: number; vehicle: string | null; late: boolean };
export type Dashboard = { kpis: Kpis; stock: TypeStock[]; materials: MaterialStock[]; weeks: WeekPoint[]; months: MonthPoint[];
  upcoming: UpcomingTrip[]; insights: Insight[]; topCustomers: Customer[]; dues: Customer[] };

export type Summary = { produced: number; damaged: number; damagePercent: number | null; delivered: number; orders: number; trips: number;
  revenue: number; sales: number; deliveryIncome: number; handlingIncome: number; materials: number; wages: number; handlingWages: number;
  salaries: number; expenses: number; totalCost: number; profit: number; margin: number | null; costPerBrick: number | null;
  pricePerBrick: number | null; discountGiven: number; discountPercent: number | null; received: number; receivable: number };
export type Report = { from: string; to: string; summary: Summary; months: MonthPoint[];
  types: { brickTypeId: number; name: string; color: string | null; produced: number; damaged: number; delivered: number; sales: number;
    avgPrice: number | null }[];
  expenseHeads: { name: string; amount: number; count: number }[]; insights: Insight[];
  materials: { materialId: number; name: string; unit: string; consumed: number; perThousand: number | null; spent: number }[] };

export type ResourceView = { resource: Resource; cycle: string; unpaid: number; unpaidCount: number; advanceOutstanding: number;
  lastPaidOn: string | null; paidThisMonth: number; paidTotal: number; monthQuantity: number; monthTrips: number; monthEarned: number };
export type SlipRow = { id: number; slipNo: string; kind: string; status: string; resourceId: number; resourceName: string; role: string;
  periodFrom: string | null; periodTo: string | null; paidOn: string; gross: number; deductions: number | null; net: number; narrative: string | null;
  account: string | null };
/** Work earned and not on a slip yet (a batch made, loading, a trip …), or a line of a slip. */
export type Earning = { id: number | null; kind: string; label: string; earnedOn: string; quantity: number | null; rate: number | null; amount: number;
  narrative: string | null; slipId?: number | null; slipNo?: string | null };
export type Advance = { advanceId: number; slipNo: string; givenOn: string; narrative: string | null; amount: number; recovered: number;
  outstanding: number; recoverPerCycle: number | null; suggested: number };
export type AdvanceLine = { resourceId: number; resourceName: string; role: string; advance: Advance };
export type Payroll = { resources: ResourceView[]; unpaidTotal: number; advancesOutstanding: number; slips: SlipRow[]; advances: AdvanceLine[] };
/** What a slip for a person or team and a period would pay (GET /bricks/payroll/preview, and each of /run). */
export type PayPreview = { resource: ResourceView; cycle: 'WEEKLY' | 'MONTHLY'; from: string; to: string; earnings: Earning[]; wage: number;
  wageLabel: string | null; wageNote: string | null; advances: Advance[]; gross: number };
export type SlipView = { slip: { id: number; slipNo: string; kind: string; status: string; net: number; paidOn: string }; resource: Resource };

export type BookAccount = { id: number; name: string; role: string | null; type: string; accountClass: string; balance: number;
  book: boolean; institution: string | null; accountNumber: string | null; upiId: string | null; monthIn: number; monthOut: number;
  entries: number };

export type Notice = { id: number; kind: string; title: string; body: string; link: string | null; actor: string | null; createdAt: string };

/** A change held for a checker: the server answers 202 with it instead of making the change. */
export type Held = { pendingApproval: true; message: string; pending: { id: number; reference?: string } };
export type PlaceOutcome = { order: OrderView | null; pending: Approval | null };

export const isHeld = (x: unknown): x is Held => !!x && typeof x === 'object' && (x as Held).pendingApproval === true;
