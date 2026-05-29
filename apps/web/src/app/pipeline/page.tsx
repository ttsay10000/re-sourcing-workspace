import { Suspense } from "react";
import PipelineClient from "./PipelineClient";
import styles from "./PipelinePage.module.css";

export default function PipelinePage() {
  return (
    <Suspense
      fallback={
        <main className={styles.page}>
          <div className={styles.loadingState}>Loading pipeline...</div>
        </main>
      }
    >
      <PipelineClient />
    </Suspense>
  );
}
