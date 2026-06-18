window.EVENT_MANAGER_CONFIG = {
  // GitHub Pagesのリポジトリ名と揃えています。
  appId: "exceed-event-manager",

  // EXCEEDのブランド設定です。
  producerName: ".EXE PRODUCE",
  producerLogoPath: "./assets/exe-produce-logo.png",
  brandName: "EXCEED",
  title: "EXCEED 勤怠・予約管理",
  eyebrow: "EXCEED Event Manager",
  logoPath: "./assets/exceed-logo.png",
  logoAlt: "EXCEED ロゴ",
  groupStores: ["EXCEED", "SYNDICATE", "THE CENTRAL"],
  stores: [
    {
      key: "exceed",
      appId: "exceed-event-manager",
      stateRowId: "exceed-event-manager",
      brandName: "EXCEED",
      title: "EXCEED 勤怠・予約管理",
      eyebrow: "EXCEED Event Manager",
      logoPath: "./assets/exceed-logo.png",
      logoAlt: "EXCEED ロゴ",
      sitePassword: "EXCEED",
      core: {
        initialUsers: [
          {
            id: "u_exceed_manager",
            display_name: "EXCEED運営",
            kana: "えくしーどうんえい",
            role: "幹部",
          },
        ],
      },
    },
    {
      key: "syndicate",
      appId: "syndicate-event-manager",
      stateRowId: "syndicate-event-manager",
      brandName: "SYNDICATE",
      title: "SYNDICATE 勤怠・予約管理",
      eyebrow: "SYNDICATE Event Manager",
      logoPath: "./assets/syndicate-logo.png",
      logoAlt: "SYNDICATE ロゴ",
      sitePassword: "SYNDICATE",
      core: {
        initialUsers: [
          {
            id: "u_syndicate_manager",
            display_name: "SYNDICATE運営",
            kana: "しんじけーとうんえい",
            role: "幹部",
          },
        ],
      },
    },
    {
      key: "central",
      appId: "central-event-manager",
      stateRowId: "central-event-manager",
      brandName: "THE CENTRAL",
      title: "THE CENTRAL 勤怠・予約管理",
      eyebrow: "THE CENTRAL Event Manager",
      logoPath: "./assets/central-logo.png",
      logoAlt: "THE CENTRAL ロゴ",
      sitePassword: "CENTRAL",
      core: {
        initialUsers: [
          {
            id: "u_central_manager",
            display_name: "THE CENTRAL運営",
            kana: "ざせんとらるうんえい",
            role: "幹部",
          },
        ],
      },
    },
  ],

  // Supabaseの共有DBへ同期します。
  storageMode: "supabase",
  supabaseUrl: "https://cdnbkbryksrhioajgorg.supabase.co",
  supabaseAnonKey: "sb_publishable_d-ydLZw9k8vNPpDnu_QDGA_ACjkGL_i",
  // Supabaseを使う場合は、イベントごとに重複しない行IDへ変更してください。
  stateRowId: "exceed-event-manager",

  // core.jsが生成する初期データをイベント向けに差し替えます。
  core: {
    sitePassword: "exceed",
    adminPassword: "exceed2026",
    // 0=日曜日 ... 4=木曜日
    eventWeekdays: [4],
    reservationOpenWeekday: 3,
    reservationOpenTime: "22:00",
    firstWeekHolidayCandidates: false,
    grandOpenDate: "2026-07-02",
    preOpenEventNote: "グランドオープン前の練習会",
    grandOpenEventNote: "グランドオープン",
    initialRoles: ["幹部", "ホスト", "体入"],
    initialUsers: [
      {
        id: "u_exceed_manager",
        display_name: "EXCEED運営",
        kana: "えくしーどうんえい",
        role: "幹部",
      },
    ],
  },
};
