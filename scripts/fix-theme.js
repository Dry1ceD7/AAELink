const fs = require('fs');
const postcss = require('postcss');

const cssPath = 'app/styles.css';
const css = fs.readFileSync(cssPath, 'utf8');

const plugin = postcss.plugin('fix-themes', () => {
  return (root) => {
    const newRules = [];
    
    // First, let's remove the old incomplete html[data-theme="dark"] rules
    // that start around the end of the file.
    root.walkRules(rule => {
      if (rule.selector.includes('html[data-theme="dark"]')) {
        rule.remove();
      }
    });

    // We also might want to remove html[data-theme="light"] rules if we want to clean them, 
    // but the light rules are just variables. Let's keep them.

    // Now, find all @media (prefers-color-scheme: dark)
    root.walkAtRules('media', rule => {
      if (rule.params.includes('prefers-color-scheme: dark')) {
        // Clone the nodes inside the media query
        rule.nodes.forEach(child => {
          if (child.type === 'rule') {
            const newRule = child.clone();
            
            // Rewrite selectors
            newRule.selectors = newRule.selectors.map(sel => {
              const s = sel.trim();
              if (s === ':root' || s === 'html') {
                return 'html[data-theme="dark"]';
              } else if (s === 'body' || s === 'html, body' || s === 'html,body') {
                return 'html[data-theme="dark"] body';
              } else if (s.startsWith('html ')) {
                return s.replace(/^html\s+/, 'html[data-theme="dark"] ');
              } else if (s.startsWith('body ')) {
                return s.replace(/^body\s+/, 'html[data-theme="dark"] body ');
              } else {
                return `html[data-theme="dark"] ${s}`;
              }
            });
            
            newRules.push(newRule);
          }
        });
        
        // Remove the media query
        rule.remove();
      }
    });

    // Append the newly prefixed rules to the end of the file
    if (newRules.length > 0) {
      root.append(postcss.comment({ text: '── Dark theme rules (auto-generated from media queries) ──' }));
      newRules.forEach(r => root.append(r));
    }
  };
});

postcss([plugin]).process(css, { from: cssPath, to: cssPath }).then(result => {
  fs.writeFileSync(cssPath, result.css);
  console.log('Successfully fixed themes in styles.css');
}).catch(err => {
  console.error(err);
});
