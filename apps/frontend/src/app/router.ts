import { createRouter, createWebHistory } from "vue-router";
import CabinetPage from "@/pages/cabinet/CabinetPage.vue";
import ChallengePlayPage from "@/pages/challenge/ChallengePlayPage.vue";
import ClubsLeaderboardPage from "@/pages/clubs/ClubsLeaderboardPage.vue";
import ClubRecordsPage from "@/pages/club-records/ClubRecordsPage.vue";
import ClubSettingsPage from "@/pages/club-settings/ClubSettingsPage.vue";
import PuzzleRecordsPage from "@/pages/records/PuzzleRecordsPage.vue";
import SuperAdminPage from "@/pages/super-admin/SuperAdminPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      redirect: "/cabinet",
    },
    {
      path: "/cabinet",
      name: "cabinet",
      component: CabinetPage,
    },
    {
      path: "/clubs",
      name: "clubs-leaderboard",
      component: ClubsLeaderboardPage,
    },
    {
      path: "/challenge/records/:chatId",
      name: "club-records",
      component: ClubRecordsPage,
    },
    {
      path: "/challenge/:discipline/:puzzleId/:edition/:chatId/:userId?",
      name: "challenge-play",
      component: ChallengePlayPage,
    },
    {
      path: "/challenge/:discipline/:puzzleId/:chatId",
      name: "challenge-play-no-edition",
      component: ChallengePlayPage,
    },
    {
      path: "/records/:discipline/:puzzleId/:edition/:chatId/:userId?",
      name: "puzzle-records",
      component: PuzzleRecordsPage,
    },
    {
      path: "/records/:discipline/:puzzleId/:chatId",
      name: "puzzle-records-no-edition",
      component: PuzzleRecordsPage,
    },
    {
      path: "/club-settings/:chatId",
      name: "club-settings",
      component: ClubSettingsPage,
    },
    {
      path: "/super-admin",
      name: "super-admin",
      component: SuperAdminPage,
    },
  ],
});

