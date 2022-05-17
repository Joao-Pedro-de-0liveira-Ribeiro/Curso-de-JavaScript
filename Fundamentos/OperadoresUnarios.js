let num1 = 1
let num2 = 2

num1++ // Incrementa +1 depois
console.log(num1) // Aumentou num1 para 2
--num1 // Decrementa -1 antes
console.log(num1) // Diminuiu num1 para 1

console.log(++num1 === num2--)
/*            ^          ^
              |          |
  Este incrementa antes, |
  logo ele vem primeiro  |
   do que a comparação   |
                         |
            Este continua sendo 2 sem fazer a 
            subtração pois ele esta decrementando depois
*/
console.log(num1 === num2)
/*  
    Este comprova que a comparação vai priorizar os valores
    pois não tem incremento ou decremento antes e depois
*/