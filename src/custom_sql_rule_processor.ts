import {defaultRuleProcessorSQL, RuleProcessor} from 'react-querybuilder'

export const customRuleProcessor: RuleProcessor = (rule, options) => {
    const caseInsensitiveOperators = [
        'contains',
        'beginsWith',
        'endsWith',
        'doesNotContain',
        'doesNotBeginWith',
        'doesNotEndWith'
    ];

    if (caseInsensitiveOperators.includes(rule.operator)) {
        switch (rule.operator) {
            case 'contains':
                return `UPPER(${rule.field}) LIKE UPPER('%${rule.value}%')`;
            case 'beginsWith':
                return `UPPER(${rule.field}) LIKE UPPER('${rule.value}%')`;
            case 'endsWith':
                return `UPPER(${rule.field}) LIKE UPPER('%${rule.value}')`;
            case 'doesNotContain':
                return `UPPER(${rule.field}) NOT LIKE UPPER('%${rule.value}%')`;
            case 'doesNotBeginWith':
                return `UPPER(${rule.field}) NOT LIKE UPPER('${rule.value}%')`;
            case 'doesNotEndWith':
                return `UPPER(${rule.field}) NOT LIKE UPPER('%${rule.value}')`;
        }
    }
    return defaultRuleProcessorSQL(rule, options);
};
