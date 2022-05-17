const escola = "Auxilium"

console.log(escola.charAt(5))   // Imprime o elemento referente ao indice indicado
console.log(escola.charAt(10))  // Quando se escolhe um elemento que não existe
console.log(escola.charCodeAt('u')) // Relaciona a tabela ASCII
console.log(escola.indexOf('i')) // Mostra a posição do elemento que foi determinado em indexOf
console.log('\n')
console.log(escola.substring(1)) // Imprime do elemento selecionado para frente
console.log(escola.substring(0,5)) // Imprime do elemento selecionado até o outro após a virgula
console.log('\n')
console.log('Escola '.concat(escola).concat("!")) // Concatenar Caracteres
console.log('Escola ' + escola + " !") // Forma alternativa de concatenar
console.log('3' + 2) // Concatena a String como prioridade
console.log('\n')
console.log(escola.replace('u', 'e')) // Substitui o elemento da esquerda pelo da direita
console.log(escola.replace(/\w/g, 'e')) // Substitui todos os elemento da esquerda pelo da direita
console.log('\n')
console.log('Ana, Maria, Pedro'.split(',')) // Coloca os elementos em um vetor