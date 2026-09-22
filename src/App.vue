<script setup lang="ts">
import UnloadingPanel from "./business/unloading/UnloadingPanel.vue";

const project = {
  folder: "hxwl/frontend/hxwlfront-21",
  framework: "vue",
  title: "油站网点 · 卸油差量索赔闭环",
  subtitle:
    "一次到站登记油站、油品、单据量和实收量；实收不得超罐容，差量超千分之五须填铅封编号和原因，否则整单拒绝。登记后索赔冻结，复查确认才按实收入库；退回须写原因，库存不变。",
  industry: "石油",
  stack: ["Vue3", "Vite", "TypeScript", "LocalStorage"]
} as const;
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">{{ project.industry }}行业前端最小闭环</p>
          <h1>{{ project.title }}</h1>
          <p class="subtitle">{{ project.subtitle }}</p>
        </div>
        <div class="stack">
          <span v-for="item in project.stack" :key="item" class="tag">{{ item }}</span>
        </div>
      </header>

      <UnloadingPanel />
    </div>
  </main>
</template>
