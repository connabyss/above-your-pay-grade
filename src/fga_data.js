// The Auth0 FGA authorization model and the starting tuples.
// fga/model.fga is the same model in the FGA DSL (paste it in the FGA dashboard's model
// editor to see it drawn). The worker writes this JSON to an empty store on first run.

const U = (type, relation) => (relation ? { type, relation } : { type });
const VIEWERS = [U("user"), { type: "user", wildcard: {} }, U("group", "member"), U("department", "member"), U("department", "manager")];

export const MODEL = {
  schema_version: "1.1",
  type_definitions: [
    { type: "user", relations: {}, metadata: null },
    {
      type: "department",
      relations: {
        manager: { this: {} },
        member: { union: { child: [{ this: {} }, { computedUserset: { object: "", relation: "manager" } }] } },
      },
      metadata: { relations: { manager: { directly_related_user_types: [U("user")] }, member: { directly_related_user_types: [U("user")] } } },
    },
    {
      type: "group",
      relations: { member: { this: {} } },
      metadata: {
        relations: { member: { directly_related_user_types: [U("user"), U("department", "member"), U("group", "member")] } },
      },
    },
    {
      type: "folder",
      relations: { viewer: { this: {} } },
      metadata: { relations: { viewer: { directly_related_user_types: VIEWERS } } },
    },
    {
      type: "document",
      relations: {
        parent: { this: {} },
        viewer: {
          union: {
            child: [{ this: {} }, { tupleToUserset: { tupleset: { object: "", relation: "parent" }, computedUserset: { object: "", relation: "viewer" } } }],
          },
        },
        can_view: { computedUserset: { object: "", relation: "viewer" } },
      },
      metadata: {
        relations: {
          parent: { directly_related_user_types: [U("folder")] },
          viewer: { directly_related_user_types: VIEWERS },
          can_view: { directly_related_user_types: [] },
        },
      },
    },
  ],
};

const t = (user, relation, object) => ({ user, relation, object });

export const TUPLES = [
  // departments and roles
  t("user:pip", "member", "department:engineering"), // intern
  t("user:sam", "member", "department:engineering"), // engineer (general employee)
  t("user:robin", "manager", "department:engineering"), // engineering manager
  t("user:jordan", "manager", "department:hr"), // HR manager
  t("user:ceo", "manager", "department:hr"), // the CEO can go anywhere HR can...
  t("user:ceo", "manager", "department:engineering"),
  t("user:ceo", "member", "department:legal"),
  // everyone with a real badge is staff
  t("department:engineering#member", "member", "group:staff"),
  t("department:hr#member", "member", "group:staff"),
  t("department:legal#member", "member", "group:staff"),
  // who may enter which floor (role AND department where it matters)
  t("user:*", "viewer", "folder:lobby"),
  t("group:staff#member", "viewer", "folder:office"),
  t("department:engineering#manager", "viewer", "folder:manager_floor"),
  t("department:hr#manager", "viewer", "folder:manager_floor"),
  t("department:hr#member", "viewer", "folder:hr_wing"),
  t("department:legal#member", "viewer", "folder:legal_wing"),
  t("department:hr#manager", "viewer", "folder:hr_payroll"), // only managers OF HR
  t("user:ceo", "viewer", "folder:vault"), // ONE identity. No game badge, no promotion, nobody else.
  // which floor each document sits on (documents inherit the floor's viewers)
  t("folder:lobby", "parent", "document:lobby_sign"),
  t("folder:office", "parent", "document:penny_manual"),
  t("folder:office", "parent", "document:pto_policy"),
  t("folder:office", "parent", "document:dress_code"),
  t("folder:office", "parent", "document:raise_guide"),
  t("folder:office", "parent", "document:intern_handbook"),
  t("folder:office", "parent", "document:stapler_memo"),
  t("folder:office", "parent", "document:vision_statement"),
  t("folder:office", "parent", "document:ferret_policy"),
  t("folder:office", "parent", "document:plant_rules"), // has a planted prompt injection inside
  t("folder:office", "parent", "document:ceo_salary_REAL_final_v2"), // DECOY (honeypot), not a real salary
  t("folder:manager_floor", "parent", "document:salaries_engineering"),
  t("folder:hr_wing", "parent", "document:holiday_party_incident"),
  t("folder:legal_wing", "parent", "document:vending_lawsuit"),
  t("folder:hr_payroll", "parent", "document:company_payroll_2026"),
  t("folder:vault", "parent", "document:ceo_pay"),
];

// The badges. All but the CEO's come from the Front Desk. Picking one is a LOGIN (a signed cookie),
// never something you can say in the chat.
export const BADGES = {
  visitor: { user: "user:visitor", name: "Unverified Visitor", role: "nobody (yet)", dept: "none", level: 0 },
  pip: { user: "user:pip", name: "Pip", role: "Intern", dept: "Engineering", level: 1 },
  sam: { user: "user:sam", name: "Sam", role: "Engineer", dept: "Engineering", level: 1 },
  robin: { user: "user:robin", name: "Robin", role: "Manager", dept: "Engineering", level: 2 },
  jordan: { user: "user:jordan", name: "Jordan", role: "Manager", dept: "HR", level: 3 },
  // Not at the Front Desk. Only a real GitHub sign-in as CEO_GITHUB_LOGIN gets this one.
  ceo: { user: "user:ceo", name: "The CEO", role: "CEO", dept: "The Vault", level: 4 },
};
