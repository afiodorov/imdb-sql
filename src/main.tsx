import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {DuckDBProvider} from './duckdb/duckdbContext';
import {BrowserRouter as Router} from "react-router-dom";

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <DuckDBProvider>
            <Router>
                <App />
            </Router>
        </DuckDBProvider>
    </StrictMode>,
)
